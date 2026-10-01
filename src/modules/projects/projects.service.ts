import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { update } from "../../common/database/record-mutations";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { ProjectsSchema } from "./dto/projects.schema";
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
  ) {
    super(db, access);
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    if (data.typeConfigs) {
      const s = await tx.systemSetting.findUnique({
        where: {
          key: "unit_types",
        },
      });
      const codes = (s?.value as any[])?.map((x) => x.code) ?? [];
      for (const v of data.typeConfigs)
        if (!codes.includes(v.code)) fail("项目引用了无效单位类型");
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
    x.coverUrl = image ? "/api/v1/materials/" + image.id + "/download" : null;
    return x;
  }
}
