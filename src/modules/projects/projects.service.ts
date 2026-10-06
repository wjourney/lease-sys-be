import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { update } from "../../common/database/record-mutations";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { ProjectsSchema } from "./dto/projects.schema";
import { normalizeUploadName } from "../materials/file-name";
import { StorageService } from "../../common/storage/storage.service";
import { number } from "../../common/utils/value";
import { projectUnitTypes } from "./project-unit-types";
@Injectable()
export class ProjectsService extends ResourceService {
  readonly resource = "projects";
  protected schema = ProjectsSchema;
  protected prefix: [string, string] = ["code", "P"];
  protected references: [string, string][] = [["unit", "projectId"]];
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
    @Inject(StorageService)
    private readonly storage: StorageService,
  ) {
    super(db, access);
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    if (!row && !data.typeConfigs?.length) fail("请至少配置一种项目单位类型");
    if (data.typeConfigs !== undefined) {
      if (!data.typeConfigs.length) fail("请至少配置一种项目单位类型");
      const codes = data.typeConfigs.map((v: any) => v.code);
      const names = data.typeConfigs.map((v: any) => v.name?.trim());
      if (
        new Set(codes).size !== codes.length ||
        new Set(names).size !== names.length
      )
        fail("项目单位类型名称或编码重复");
      for (const v of data.typeConfigs) {
        if (
          !v.name?.trim() ||
          [v.minArea, v.maxArea, v.minRent, v.maxRent].some((x) => x == null)
        )
          fail("请填写类型名称、面积范围和月租范围");
        if (
          number(v.minArea).lte(0) ||
          number(v.minArea).gt(v.maxArea) ||
          number(v.minRent).gt(v.maxRent)
        )
          fail("请检查单位类型的面积和月租范围");
      }
      if (
        row &&
        (await tx.unit.count({
          where: { projectId: row.id, unitTypeCode: { notIn: codes } },
        }))
      )
        fail("已有单位使用的类型不能删除，请保留类型");
    }
  }
  async orderLogos(a: Actor, projectId: string, body: any) {
    this.access.allow(a, "projects", true);
    const ids = z.array(z.string().uuid()).max(4).parse(body.ids);
    if (new Set(ids).size !== ids.length) fail("Logo 列表包含重复文件");
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      await this.access.get(a, "projects", projectId, tx);
      const logos = await tx.material.findMany({
        where: {
          projectId,
          category: "LOGO",
          storageKey: { not: null },
          deletedAt: null,
          isCurrent: true,
        },
      });
      if (
        logos.length !== ids.length ||
        ids.some((id) => !logos.some((logo) => logo.id === id))
      )
        fail("Logo 列表已变化，请刷新后重试");
      for (const [index, id] of ids.entries()) {
        const logo = logos.find((item) => item.id === id)!;
        if (logo.sortOrder !== index)
          await update(
            tx,
            "materials",
            logo,
            { sortOrder: index },
            a,
            "调整项目 Logo 顺序",
          );
      }
      return { ok: true };
    });
  }
  async enrich(a: Actor, row: any) {
    const x = await super.enrich(a, row);
    x.typeConfigs = await projectUnitTypes(this.db, row);
    const units = await this.db.unit.findMany({
      where: {
        projectId: row.id,
        deletedAt: null,
      },
      select: {
        id: true,
      },
    });
    const occupied = await this.db.order.findMany({
      where: {
        unitId: {
          in: units.map((u) => u.id),
        },
        deletedAt: null,
        status: {
          not: "CLOSED",
        },
        occupancyState: {
          not: "RELEASED",
        },
      },
      select: {
        unitId: true,
        occupancyState: true,
      },
    });
    x.unitCount = units.length;
    x.occupiedCount = new Set(
      occupied
        .filter((o) => o.occupancyState === "OCCUPIED")
        .map((o) => o.unitId),
    ).size;
    x.lockedCount = new Set(
      occupied
        .filter((o) => o.occupancyState === "LOCKED")
        .map((o) => o.unitId),
    ).size;
    x.availableCount =
      units.length - new Set(occupied.map((o) => o.unitId)).size;
    const imageFilter = {
      projectId: row.id,
      mimeType: { startsWith: "image/" },
      storageKey: { not: null },
      deletedAt: null,
      isCurrent: true,
      ...(!internal(a) ? { visibility: "SHARED" } : {}),
    };
    const image =
      (await this.db.material.findFirst({
        where: { ...imageFilter, category: "PHOTO" },
        orderBy: { createdAt: "desc" },
      })) ??
      (await this.db.material.findFirst({
        where: { ...imageFilter, category: "LOGO" },
        orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
      }));
    x.coverUrl = image
      ? await this.storage.previewUrl(
          {
            storageProvider: image.storageProvider,
            storageKey: image.storageKey!,
          },
          `/api/v1/materials/${image.id}/download`,
        )
      : null;
    return x;
  }
  async detail(a: Actor, key: string) {
    const project = await super.detail(a, key);
    const materials = await this.db.material.findMany({
      where: {
        projectId: key,
        deletedAt: null,
        isCurrent: true,
        ...(!internal(a) ? { visibility: "SHARED" } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return {
      ...project,
      materials: await Promise.all(
        materials.map(async ({ operationLogs, ...material }) => ({
          ...material,
          originalName: material.originalName
            ? normalizeUploadName(material.originalName)
            : null,
          downloadUrl: material.storageKey
            ? `/api/v1/materials/${material.id}/download`
            : null,
          previewUrl: material.storageKey
            ? await this.storage.previewUrl(
                {
                  storageProvider: material.storageProvider,
                  storageKey: material.storageKey,
                },
                `/api/v1/materials/${material.id}/download`,
              )
            : null,
        })),
      ),
    };
  }
}
