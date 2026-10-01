import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { CommissionsSchema } from "./dto/commissions.schema";
@Injectable()
export class CommissionsService extends ResourceService {
  readonly resource = "commissions";
  protected schema = CommissionsSchema;
  protected prefix: [string, string] = ["commissionNo", "CM"];
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
    const o = await this.access.get(a, "orders", d.orderId, tx);
    if (d.periodStart > d.periodEnd) fail("结算期间无效");
    data.salesCompanyId = o.salesCompanyId;
    data.salesUserId = o.salesUserId;
    if (row) {
      const es = await tx.expense.findMany({
        where: {
          commissionId: row.id,
          status: {
            in: ["PAID", "UNPAID"],
          },
          deletedAt: null,
        },
      });
      const total = es.reduce((n, e) => n.add(e.amount), number(0));
      if (es.length && data.orderId && data.orderId !== row.orderId)
        fail("已有付款计划不能更换订单");
      if (data.amount === null && es.length) fail("已有付款记录不能清空金额");
      if (data.amount != null && number(data.amount).lt(total))
        fail("佣金不能小于已付款及付款计划金额");
    }
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    const key = row.id;
    if (
      await tx.expense.count({
        where: {
          commissionId: key,
          deletedAt: null,
        },
      })
    )
      fail("已有支出关联，不能删除佣金");
  }
  async enrich(a: Actor, row: any) {
    const x = await super.enrich(a, row);
    const es = await this.db.expense.findMany({
      where: {
        commissionId: row.id,
        deletedAt: null,
        status: {
          in: ["PAID", "UNPAID"],
        },
      },
    });
    x.paidAmount = es
      .filter((e) => e.status === "PAID")
      .reduce((n, e) => n.add(e.paidAmount), number(0))
      .toString();
    x.remainingAmount =
      row.amount === null
        ? null
        : number(row.amount).sub(x.paidAmount).toString();
    x.status =
      row.amount === null
        ? "UNSET"
        : number(x.remainingAmount).eq(0)
          ? "PAID"
          : number(x.paidAmount).gt(0)
            ? "PARTIAL"
            : "OPEN";
    return x;
  }
}
