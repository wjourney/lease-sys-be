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
import { validateUnitType, unitTypeValues, unitNumber } from "./unit-type-values";
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
      for (const v of data.typeConfigs) validateUnitType(v);
      if (
        row &&
        (await tx.unit.count({
          where: { projectId: row.id, deletedAt: null, unitTypeCode: { notIn: codes } },
        }))
      )
        fail("已有单位使用的类型不能删除，请保留类型");
      if (row) {
        const allUnits = await tx.unit.findMany({ where: { projectId: row.id } });
        const units = allUnits.filter((unit: any) => !unit.deletedAt);
        const addresses = units.map((unit: any) => {
          const type = data.typeConfigs.find((v: any) => v.code === unit.unitTypeCode);
          return JSON.stringify([type.building, type.floor, unit.roomNo]);
        });
        if (new Set(addresses).size !== addresses.length) fail("调整类型后出现重复房号，请检查期/座和楼层");
        for (const unit of units) {
          const type = data.typeConfigs.find((v: any) => v.code === unit.unitTypeCode);
          const values = { ...unitTypeValues(type, unit.extra), unitNo: unitNumber(type, unit.roomNo) };
          if (allUnits.some((other: any) => other.id !== unit.id && other.unitNo === values.unitNo))
            fail("调整后的单位编号与现有或历史单位冲突，请先调整期/座或楼层");
          if (Object.entries(values).some(([key, value]) => JSON.stringify(value) !== JSON.stringify((unit as any)[key])))
            await update(tx, "units", unit, values, a, "同步项目单位类型资料（成交价及订单快照不变）");
        }
      }
    }
  }
  async orderImages(a: Actor, projectId: string, body: any) {
    this.access.allow(a, "projects", true);
    const ids = z.array(z.string().uuid()).max(100).parse(body.ids);
    if (new Set(ids).size !== ids.length) fail("项目图片列表包含重复文件");
    return this.db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM projects WHERE id = ${projectId} FOR UPDATE`;
      await this.access.get(a, "projects", projectId, tx);
      const images = await tx.material.findMany({
        where: {
          projectId,
          category: { in: ["PHOTO", "LOGO"] },
          storageKey: { not: null },
          deletedAt: null,
          isCurrent: true,
        },
      });
      if (
        images.length !== ids.length ||
        ids.some((id) => !images.some((image) => image.id === id))
      )
        fail("项目图片列表已变化，请刷新后重试");
      for (const [index, id] of ids.entries()) {
        const image = images.find((item) => item.id === id)!;
        if (image.sortOrder !== index)
          await update(
            tx,
            "materials",
            image,
            { sortOrder: index },
            a,
            "调整项目图片顺序与 Logo",
          );
      }
      return { ok: true };
    });
  }
  protected async enrichMany(a: Actor, rows: any[]) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [units, orders, images, dictionary] = await Promise.all([
      this.db.unit.findMany({ where: { projectId: { in: ids } } }),
      this.db.order.findMany({ where: { projectId: { in: ids }, deletedAt: null, status: { not: "CLOSED" }, occupancyState: { not: "RELEASED" } }, select: { projectId: true, unitId: true } }),
      this.db.material.findMany({ where: { projectId: { in: ids }, category: { in: ["PHOTO", "LOGO"] }, mimeType: { startsWith: "image/" }, storageKey: { not: null }, deletedAt: null, isCurrent: true, ...(!internal(a) ? { visibility: "SHARED" as const } : {}) }, orderBy: [{ sortOrder: "asc" }, { category: "asc" }, { createdAt: "asc" }] }),
      this.db.systemSetting.findUnique({ where: { key: "unit_types" } }),
    ]);
    return Promise.all(rows.map((row) => this.enrich(a, row, {
      units: units.filter((unit) => unit.projectId === row.id),
      orders: orders.filter((order) => order.projectId === row.id),
      images: images.filter((image) => image.projectId === row.id), dictionary,
    })));
  }
  async enrich(a: Actor, row: any, context?: any) {
    const x = await super.enrich(a, row);
    x.typeConfigs = (await projectUnitTypes(this.db, row, context?.units, context?.dictionary)).map((type) => {
      const value = { ...type };
      if (!internal(a) && !row.salesCanViewExactRent) delete value.referenceRent;
      return value;
    });
    const allUnits = context?.units ?? await this.db.unit.findMany({
      where: { projectId: row.id },
      select: { id: true, unitTypeCode: true, deletedAt: true },
    });
    const units = allUnits.filter((unit) => !unit.deletedAt);
    if (["SUPER_ADMIN", "OPERATIONS"].includes(a.role)) {
      const usage: Record<string, number> = Object.create(null);
      for (const unit of units)
        usage[unit.unitTypeCode] = (usage[unit.unitTypeCode] ?? 0) + 1;
      x.unitTypeUsage = usage;
    }
    const occupied = context?.orders ?? await this.db.order.findMany({
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
    x.canDelete = units.length === 0;
    x.deleteReason = units.length ? "请先删除项目下的单位" : null;
    x.occupiedCount = new Set(occupied.map((o) => o.unitId)).size;
    x.lockedCount = 0;
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
    const image = context ? context.images[0] : await this.db.material.findFirst({
      where: { ...imageFilter, category: { in: ["PHOTO", "LOGO"] } },
      orderBy: [{ sortOrder: "asc" }, { category: "asc" }, { createdAt: "asc" }],
    });
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
    const project = await this.enrich(
      a,
      await this.access.get(a, this.resource, key),
    );
    const materials = await this.db.material.findMany({
      where: {
        projectId: key,
        deletedAt: null,
        isCurrent: true,
        ...(!internal(a) ? { visibility: "SHARED" } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { category: "asc" }, { createdAt: "asc" }],
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
