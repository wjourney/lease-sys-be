import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { UnitsSchema } from "./dto/units.schema";
import { normalizeUploadName } from "../materials/file-name";
import { StorageService } from "../../common/storage/storage.service";
import { projectUnitTypes } from "../projects/project-unit-types";
import { lock } from "../../common/database/record-mutations";
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
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    const d = {
      ...row,
      ...data,
    };
    await lock(tx, "projects", d.projectId);
    const project = await this.access.get(a, "projects", d.projectId, tx);
    const types = await projectUnitTypes(tx, project);
    if (!types.some((x) => x.code === d.unitTypeCode))
      fail("请选择所属项目的单位类型");
    if (number(d.area).lte(0)) fail("实用面积必须大于 0");
    if (number(d.minRent).gt(d.maxRent)) fail("最低价不得高于最高价");
    if (
      number(d.referenceRent).lt(d.minRent) ||
      number(d.referenceRent).gt(d.maxRent)
    )
      fail("参考月租须介于最低价和最高价之间");
    if (row && data.projectId && data.projectId !== row.projectId)
      fail("已有单位不能转移项目");
  }
  async enrich(a: Actor, row: any) {
    const x = await super.enrich(a, row);
    const project = await this.db.project.findUnique({
      where: { id: row.projectId },
    });
    const types = project ? await projectUnitTypes(this.db, project) : [];
    x.unitTypeName =
      types.find((item) => item.code === row.unitTypeCode)?.name ??
      row.unitTypeCode;
    const o = await this.db.order.findFirst({
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
    x.occupancyStatus = o?.occupancyState ?? "AVAILABLE";
    const firstPhoto = await this.db.material.findFirst({
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
