import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { paymentActors, resolveOperationActors } from "../../common/database/operation-actors";
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
    if (!q.status || q.status === "ALL") return [{ status: { not: "VOID" } }];
    if (q.status === "VOID") return [{ status: "VOID" }];
    if (q.status === "UNSET")
      return [{ status: { not: "VOID" }, amount: null }];
    if (!["OPEN", "PARTIAL", "PAID"].includes(q.status))
      return [{ id: { in: [] } }];
    const commissions = await this.db.commission.findMany({
      where: {
        AND: [
          { deletedAt: null, status: { not: "VOID" } },
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
              if (c.amount == null) return q.status === "OPEN";
              const paid = number(sums.get(c.id));
              return (
                (q.status === "OPEN"
                  ? paid.lt(c.amount!)
                  : q.status === "PARTIAL"
                    ? paid.gt(0) && paid.lt(c.amount!)
                    : paid.gte(c.amount!))
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
  async detail(a: Actor, key: string) {
    // Authorize the commission before loading any related business or payment data.
    const result = await super.detail(a, key);
    let order: any;
    try {
      order = await this.access.get(a, "orders", result.orderId);
    } catch (error) {
      if (!(error instanceof NotFoundException)) throw error;
    }
    const [project, unit, expenses] = await Promise.all([
      order?.projectId ? this.db.project.findUnique({ where: { id: order.projectId }, select: { name: true } }) : null,
      order?.unitId ? this.db.unit.findUnique({ where: { id: order.unitId }, select: { unitNo: true } }) : null,
      financial(a) ? this.db.expense.findMany({ where: { commissionId: key, deletedAt: null, status: "PAID", paidAmount: { gt: 0 } }, orderBy: [{ paidOn: "desc" }, { createdAt: "desc" }] }) : [],
    ]);
    const records = expenses.flatMap((expense) => {
      const stored = Array.isArray(expense.paymentRecords) && expense.paymentRecords.length
        ? expense.paymentRecords as any[] : [];
      const payments = stored.length ? stored : [{ amount: expense.paidAmount.toString(), paidOn: expense.paidOn, fundAccountId: expense.fundAccountId, paymentMethod: expense.paymentMethod, bankReference: expense.bankReference }];
      return paymentActors(payments, Array.isArray(expense.operationLogs) ? expense.operationLogs : [], !stored.length)
        .filter((payment) => number(payment.amount).gt(0))
        .map((payment, index) => ({ ...payment, id: `${expense.id}:${payment.sourceKey || index}`, currency: expense.currency }));
    });
    const [accounts, identities] = await Promise.all([
      records.length ? this.db.fundAccount.findMany({ where: { id: { in: [...new Set(records.map((r) => r.fundAccountId).filter(Boolean))] } }, select: { id: true, name: true } }) : [],
      resolveOperationActors(this.db, records),
    ]);
    const accountNames = new Map(accounts.map((account) => [account.id, account.name] as const));
    return {
      ...result,
      orderSummary: order ? {
        orderNo: order.orderNo,
        tenantName: order.tenantName,
        projectName: project?.name || null,
        unitNo: unit?.unitNo || null,
        startsOn: order.startsOn,
        endsOn: order.endsOn,
        monthlyRent: order.monthlyRent?.toString() ?? null,
        currency: order.currency,
      } : null,
      ...(financial(a) ? { paymentRecords: records.map((record, index) => ({
        id: record.id, paidOn: record.paidOn, amount: number(record.amount).toFixed(2), currency: record.currency,
        accountName: accountNames.get(record.fundAccountId) || "—", paymentMethod: record.paymentMethod,
        actorId: identities[index].actorId, actorName: identities[index].actorName, actorPhone: identities[index].actorPhone,
        actorUsername: identities[index].actorUsername, actorType: identities[index].actorType, actorDeleted: identities[index].actorDeleted,
      })) } : {}),
    };
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
          ? "OPEN"
          : number(x.remainingAmount).lte(0)
            ? "PAID"
            : "OPEN";
    return x;
  }
}
