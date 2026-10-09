import { BatchMediaUploadSchema, readBatchMedia, signBatchMedia } from "./batch-media";
import { uploadFileType } from "../materials/upload-file-type";
import { createHash } from "node:crypto";
import { UnitBatchSchema } from "./dto/unit-batch.schema";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { UnitsSchema } from "./dto/units.schema";
import { normalizeUploadName } from "../materials/file-name";
import { StorageService } from "../../common/storage/storage.service";
import { projectUnitTypes } from "../projects/project-unit-types";
import { unitTypeValues, unitNumber } from "../projects/unit-type-values";
import { insert, lock } from "../../common/database/record-mutations";
@Injectable()
export class UnitsService extends ResourceService {
  readonly resource = "units";
  protected schema = UnitsSchema;
  protected references: [string, string][] = [["order", "unitId"]];
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
  protected async validate(a: Actor, data: any, tx: any, row?: any, batchTypes?: any[]) {
    const d = {
      ...row,
      ...data,
    };
    let types = batchTypes;
    if (!types) {
      await lock(tx, "projects", d.projectId);
      const project = await this.access.get(a, "projects", d.projectId, tx);
      types = await projectUnitTypes(tx, project);
    }
    const type = types.find((x) => x.code === d.unitTypeCode);
    if (!type) fail("请选择所属项目的单位类型");
    Object.assign(data, unitTypeValues(type, { ...row?.extra, ...data.extra }));
    if (!d.roomNo?.trim()) fail("请填写房号");
    data.roomNo = d.roomNo.trim();
    data.unitNo = unitNumber(type, data.roomNo);
    const duplicate = await tx.unit.findFirst({ where: { projectId: d.projectId, OR: [{ building: type.building, floor: type.floor, roomNo: data.roomNo }, { unitNo: data.unitNo }], ...(row ? { id: { not: row.id } } : {}) } });
    if (duplicate) fail(duplicate.deletedAt ? "此房号已被历史单位使用，请使用其他房号" : "该期/座、楼层下已存在此房号");
    if (row && data.projectId && data.projectId !== row.projectId)
      fail("已有单位不能转移项目");
  }
  protected async beforeRemove(_a: Actor, tx: any, row: any) {
    const occupied = await tx.order.findFirst({
      where: {
        unitId: row.id,
        deletedAt: null,
        status: { not: "CLOSED" },
        occupancyState: { not: "RELEASED" },
      },
      select: { id: true },
    });
    if (occupied) fail("已租单位不能删除");
  }
  async uploadBatchMedia(a: Actor, body: unknown, file: Express.Multer.File) {
    this.access.allow(a, "units", true);
    const { projectId, category } = BatchMediaUploadSchema.parse(body);
    await this.access.get(a, "projects", projectId);
    const mimeType = uploadFileType(file, category);
    const originalName = normalizeUploadName(file.originalname);
    if ([...originalName].length > 255) fail("文件名不能超过 255 个字符");
    const stored = await this.storage.save(file.buffer, mimeType);
    // No business record until the batch commits; unused uploads are collected by storage cleanup.
    const media = { ...stored, category, mimeType, originalName };
    return { token: signBatchMedia(a.id, projectId, media), name: media.originalName, category };
  }
  async batch(a: Actor, body: unknown, preview = false) {
    this.access.allow(a, "units", true);
    const input = UnitBatchSchema.parse(body);
    const { requestId, projectId, rows, mediaTokens = [] } = input;
    const fingerprint = createHash("sha256").update(JSON.stringify({ projectId, rows, ...(mediaTokens.length ? { mediaTokens } : {}), ...(input.sharedMediaIndexes !== undefined ? { sharedMediaIndexes: input.sharedMediaIndexes } : {}) })).digest("hex");
    return this.db.$transaction(async (tx) => {
      await lock(tx, "projects", projectId);
      const project = await this.access.get(a, "projects", projectId, tx);
      const previous = await tx.unitCreationBatch.findUnique({ where: { id: requestId } });
      if (previous) {
        if (previous.actorId !== a.id || previous.fingerprint !== fingerprint)
          throw new ConflictException("重复提交编号冲突");
        return { ok: true, replayed: true, unitIds: previous.unitIds, count: (previous.unitIds as string[]).length };
      }
      const media = mediaTokens.map((token) => readBatchMedia(token, a.id, projectId));
      if (new Set(media.map((file) => file.storageKey)).size !== media.length) fail("批量资料不能重复");
      for (const file of media) await this.storage.size(file);
      const sharedIndexes = input.sharedMediaIndexes ?? media.map((_, i) => i);
      const rowIndexes = rows.map(row => row.mediaIndexes ?? sharedIndexes);
      if ([sharedIndexes, ...rowIndexes].some(indexes => indexes.some(i => i >= media.length))) fail("批量资料索引无效");
      const types = await projectUnitTypes(tx, project);
      const prepared: any[] = [];
      const issues: { row: number; message: string }[] = [];
      const seen = new Map<string, number>();
      for (const [index, item] of rows.entries()) {
        const { mediaIndexes: _mediaIndexes, ...fields } = item;
        const data: any = { projectId, ...fields };
        try {
          await this.validate(a, data, tx, undefined, types);
          const identity = data.unitNo.normalize("NFKC").toLocaleLowerCase();
          const earlier = seen.get(identity);
          if (earlier !== undefined) {
            issues.push({ row: index, message: `与第 ${earlier + 1} 行房号重复` });
          } else seen.set(identity, index);
          prepared.push(data);
        } catch (error) {
          // Only expected business validation errors become row feedback.
          if (!(error instanceof Error) || !("getStatus" in error) || (error as any).getStatus() !== 400) throw error;
          issues.push({ row: index, message: error.message });
        }
      }
      if (issues.length) return { ok: false, issues };
      if (preview) return { ok: true, count: rows.length };
      const unitIds: string[] = [];
      for (const [index, data] of prepared.entries()) {
        const unit = await insert(tx, "units", data, a);
        unitIds.push(unit.id);
        for (const [sortOrder, file] of rowIndexes[index].map(i => media[i]).entries()) {
          await insert(tx, "materials", {
            ...file, unitId: unit.id, title: [...file.originalName].slice(0, 191).join(""), visibility: "SHARED", sortOrder,
          }, a);
        }
      }
      await tx.unitCreationBatch.create({ data: { id: requestId, projectId, actorId: a.id, fingerprint, unitIds } });
      return { ok: true, count: unitIds.length, unitIds };
    }, { maxWait: 10000, timeout: 60000 });
  }
  protected async enrichMany(a: Actor, rows: any[]) {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const projectIds = [...new Set(rows.map((row) => row.projectId))];
    const [projects, units, orders, images, dictionary] = await Promise.all([
      this.db.project.findMany({ where: { id: { in: projectIds } } }),
      this.db.unit.findMany({ where: { projectId: { in: projectIds } } }),
      this.db.order.findMany({ where: { unitId: { in: ids }, deletedAt: null }, orderBy: { startsOn: "asc" } }),
      this.db.material.findMany({ where: { unitId: { in: ids }, category: "PHOTO", storageKey: { not: null }, deletedAt: null, isCurrent: true, ...(!internal(a) ? { visibility: "SHARED" as const } : {}) }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
      this.db.systemSetting.findUnique({ where: { key: "unit_types" } }),
    ]);
    const types = new Map(await Promise.all(projects.map(async (project) => [project.id, await projectUnitTypes(this.db, project, units.filter((unit) => unit.projectId === project.id), dictionary)] as const)));
    const byProject = new Map(projects.map((project) => [project.id, project]));
    return Promise.all(rows.map((row) => this.enrich(a, row, {
      project: byProject.get(row.projectId), types: types.get(row.projectId) ?? [],
      orders: orders.filter((order) => order.unitId === row.id),
      images: images.filter((image) => image.unitId === row.id),
    })));
  }
  async enrich(a: Actor, row: any, context?: any) {
    const project = context?.project ?? await this.db.project.findUnique({
      where: { id: row.projectId },
    });
    const x = await super.enrich(a, row, context ?? { project });
    const types = context?.types ?? (project ? await projectUnitTypes(this.db, project) : []);
    x.unitTypeName =
      types.find((item) => item.code === row.unitTypeCode)?.name ??
      row.unitTypeCode;
    const o = context ? context.orders.find((order: any) => order.status !== "CLOSED" && order.occupancyState !== "RELEASED") : await this.db.order.findFirst({
      where: {
        unitId: row.id,
        deletedAt: null,
        occupancyState: {
          not: "RELEASED",
        },
        status: {
          not: "CLOSED",
        },
      },
      orderBy: {
        startsOn: "asc",
      },
    });
    x.occupancyStatus = o ? "OCCUPIED" : "AVAILABLE";
    const referenced = context ? context.orders.length > 0 : !!(await this.db.order.count({ where: { unitId: row.id, deletedAt: null } }));
    x.canDelete = !o && !referenced;
    x.deleteReason = o ? "已租单位不能删除" : referenced ? "该单位有历史订单记录，不能删除" : null;
    const firstPhoto = context ? context.images[0] : await this.db.material.findFirst({
      where: {
        unitId: row.id,
        category: "PHOTO",
        storageKey: { not: null },
        deletedAt: null,
        isCurrent: true,
        ...(!internal(a) ? { visibility: "SHARED" as const } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, storageProvider: true, storageKey: true },
    });
    x.coverUrl = firstPhoto?.storageKey
      ? await this.storage.previewUrl(
          {
            storageProvider: firstPhoto.storageProvider,
            storageKey: firstPhoto.storageKey,
          },
          `/api/v1/materials/${firstPhoto.id}/download`,
        )
      : null;
    return x;
  }
  async detail(a: Actor, key: string) {
    const unit = await super.detail(a, key);
    const materials = await this.db.material.findMany({
      where: {
        unitId: key,
        deletedAt: null,
        isCurrent: true,
        ...(!internal(a) ? { visibility: "SHARED" } : {}),
      },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    return {
      ...unit,
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
