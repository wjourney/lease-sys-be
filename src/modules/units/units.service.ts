import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { UnitsSchema } from "./dto/units.schema";
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
  ) {
    super(db, access);
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    const d = {
      ...row,
      ...data,
    };
    await this.access.get(a, "projects", d.projectId, tx);
    const s = await tx.systemSetting.findUnique({
      where: {
        key: "unit_types",
      },
    });
    if (
      !(s?.value as any[])?.some(
        (x) =>
          x.code === d.unitTypeCode &&
          (x.enabled || row?.unitTypeCode === x.code),
      )
    )
      fail("请选择有效单位类型");
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
    const dictionary = await this.db.systemSetting.findUnique({
      where: {
        key: "unit_types",
      },
    });
    x.unitTypeName =
      (dictionary?.value as any[])?.find(
        (item) => item.code === row.unitTypeCode,
      )?.name ?? row.unitTypeCode;
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
      select: { id: true },
    });
    x.coverUrl = firstPhoto
      ? `/api/v1/materials/${firstPhoto.id}/download`
      : null;
    return x;
  }
}
