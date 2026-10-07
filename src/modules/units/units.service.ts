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
import { unitTypeValues } from "../projects/unit-type-values";
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
    const type = types.find((x) => x.code === d.unitTypeCode);
    if (!type) fail("请选择所属项目的单位类型");
    Object.assign(data, unitTypeValues(type, { ...row?.extra, ...data.extra }));
    if (!d.roomNo?.trim()) fail("请填写房号");
    data.roomNo = d.roomNo.trim();
    data.unitNo = `${type.building} ${/楼$/.test(type.floor) ? type.floor : `${type.floor}楼`} ${data.roomNo}`;
    if (number(d.referenceRent).lt(type.minRent) || number(d.referenceRent).gt(type.maxRent))
      fail("月租价格须介于单位类型的最低价和最高价之间");
    const duplicate = await tx.unit.findFirst({ where: { projectId: d.projectId, building: type.building, floor: type.floor, roomNo: data.roomNo, deletedAt: null, ...(row ? { id: { not: row.id } } : {}) } });
    if (duplicate) fail("该期/座、楼层下已存在此房号");
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
    x.occupancyStatus = o ? "OCCUPIED" : "AVAILABLE";
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
