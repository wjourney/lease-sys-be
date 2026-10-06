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
  async create(_a: Actor, _body: any): Promise<never> {
    return fail("佣金由订单生成，请在订单中填写佣金约定");
  }
  protected async listConditions(a: Actor, q: any): Promise<any[]> {
    if (!q.status) return [];
    if (q.status === "VOID") return [{ status: "VOID" }];
    if (q.status === "UNSET")
      return [{ status: { not: "VOID" }, amount: null }];
    if (!["OPEN", "PARTIAL", "PAID"].includes(q.status))
      return [{ id: { in: [] } }];
    const commissions = await this.db.commission.findMany({
      where: {
        AND: [
          { deletedAt: null, status: { not: "VOID" }, amount: { not: null } },
          await this.access.scope(a, "commissions"),
        ],
      },
      select: { id: true, amount: true },
    });
    const payments = await this.db.expense.groupBy({
      by: ["commissionId"],
      where: {
        commissionId: { in: commissions.map((c) => c.id) },
        deletedAt: null,
        status: "PAID",
      },
      _sum: { paidAmount: true },
    });
    const sums = new Map(
      payments.map((p) => [p.commissionId, p._sum.paidAmount]),
    );
    return [
      {
        id: {
          in: commissions
            .filter((c) => {
              const paid = number(sums.get(c.id));
              return (
                (paid.gte(c.amount!)
                  ? "PAID"
                  : paid.gt(0)
                    ? "PARTIAL"
                    : "OPEN") === q.status
              );
            })
            .map((c) => c.id),
        },
      },
    ];
  }
  protected async beforeEdit(a: Actor, d: any, tx: any, row: any) {
    if (
      ["ONE_TIME", "RECURRING_MONTHLY"].includes(row.mode) ||
      row.status === "VOID"
    )
      fail("订单佣金请通过订单修改，不能直接编辑");
    if (
      await tx.expense.count({
        where: {
          commissionId: row.id,
          deletedAt: null,
          status: { not: "VOID" },
        },
      })
    )
      fail("佣金已有付款计划或付款记录，不能修改约定");
    // Legacy incomplete commissions may be completed, but cannot be reassigned to another order.
    if (d.orderId && d.orderId !== row.orderId) fail("不能更换佣金关联订单");
    if ((d.mode && d.mode !== row.mode) ||
      (d.periodStart && d.periodStart.getTime() !== row.periodStart.getTime()) ||
      (d.periodEnd && d.periodEnd.getTime() !== row.periodEnd.getTime()))
      fail("历史佣金只能补全金额、结付日期和备注，结算约定请在订单处理");
    if (d.amount === null || (d.amount !== undefined && number(d.amount).lte(0)))
      fail("佣金金额必须大于零");
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
  protected async beforeRemove() {
    fail("佣金不能删除，请通过订单作废未支付佣金");
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
    x.plannedAmount = es
      .filter((e) => e.status === "UNPAID")
      .reduce((n, e) => n.add(e.amount), number(0))
      .toString();
    x.availableAmount =
      row.amount === null
        ? null
        : number(row.amount).sub(x.paidAmount).sub(x.plannedAmount).toString();
    x.remainingAmount =
      row.amount === null
        ? null
        : number(row.amount).sub(x.paidAmount).toString();
    x.status =
      row.status === "VOID"
        ? "VOID"
        : row.amount === null
          ? "UNSET"
          : number(x.remainingAmount).lte(0)
            ? "PAID"
            : number(x.paidAmount).gt(0)
              ? "PARTIAL"
              : "OPEN";
    return x;
  }
}
