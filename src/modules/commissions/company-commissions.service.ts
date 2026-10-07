import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { Actor } from "../../common/auth/actor";
import { demand } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";

export const CompanyCommissionQuery = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    currency: z.enum(["HKD", "CNY", "USD"]).default("HKD"),
    salesUserId: z.string().uuid().optional(),
    q: z.string().trim().max(100).optional(),
    status: z
      .enum(["OPEN", "PARTIAL", "PAID", "VOID", "UNSET", "ALL"])
      .optional(),
    mode: z
      .enum(["MONTHLY", "YEARLY", "ONE_TIME", "RECURRING_MONTHLY"])
      .optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(12),
  })
  .strict()
  .refine(
    (q) =>
      q.from <= q.to &&
      Date.parse(q.to) - Date.parse(q.from) <= 1096 * 86400000,
    "日期范围无效或超过三年",
  );

export function commissionTotals(rows: any[]) {
  const active = rows.filter((r) => r.status !== "VOID");
  const sum = (key: string) =>
    active.reduce((n, r) => n.add(r[key] ?? 0), number(0)).toFixed(2);
  return {
    amount: sum("amount"),
    paidAmount: sum("paidAmount"),
    remainingAmount: sum("remainingAmount"),
    orderCount: new Set(active.map((r) => r.orderId)).size,
    unsetCount: active.filter((r) => r.amount === null).length,
  };
}

@Injectable()
export class CompanyCommissionsService {
  constructor(@Inject(PrismaService) readonly db: PrismaService) {}
  private allowed(a: Actor) {
    demand(
      ["SALES_COMPANY_ADMIN", "SALES"].includes(a.role) && !!a.salesCompanyId,
    );
  }
  private async snapshot(
    a: Actor,
    q?: z.infer<typeof CompanyCommissionQuery>,
    id?: string,
  ) {
    this.allowed(a);
    return this.db.$transaction(
      async (tx) => {
        const orders = await tx.order.findMany({
          where: {
            salesCompanyId: a.salesCompanyId!,
            deletedAt: null,
            ...(a.role === "SALES" ? { salesUserId: a.id } : {}),
          },
          select: { id: true, orderNo: true, projectId: true, unitId: true },
        });
        const records = await tx.commission.findMany({
          where: {
            salesCompanyId: a.salesCompanyId!,
            deletedAt: null,
            orderId: { in: orders.map((o) => o.id) },
            ...(id
              ? { id }
              : {
                  currency: q!.currency,
                  dueOn: { gte: new Date(q!.from), lte: new Date(q!.to) },
                  ...(q!.salesUserId ? { salesUserId: q!.salesUserId } : {}),
                  ...(q!.mode ? { mode: q!.mode } : {}),
                }),
            ...(a.role === "SALES" ? { salesUserId: a.id } : {}),
          },
          orderBy: [{ dueOn: "desc" }, { commissionNo: "desc" }],
        });
        if (id && !records.length)
          throw new NotFoundException("记录不存在或无访问权限");
        const [users, projects, units, payments] = await Promise.all([
          tx.user.findMany({
            where:
              a.role === "SALES"
                ? { id: a.id, salesCompanyId: a.salesCompanyId! }
                : {
                    OR: [
                      { salesCompanyId: a.salesCompanyId! },
                      { id: { in: records.map((c) => c.salesUserId) } },
                    ],
                  },
            select: { id: true, name: true },
          }),
          tx.project.findMany({
            where: { id: { in: orders.map((o) => o.projectId).filter((id): id is string => !!id) } },
            select: { id: true, name: true },
          }),
          tx.unit.findMany({
            where: { id: { in: orders.map((o) => o.unitId).filter((id): id is string => !!id) } },
            select: { id: true, unitNo: true },
          }),
          tx.expense.findMany({
            where: {
              commissionId: { in: records.map((c) => c.id) },
              deletedAt: null,
              status: { not: "VOID" },
            },
            select: {
              commissionId: true,
              expenseNo: true,
              paidOn: true,
              paidAmount: true,
              currency: true,
            },
          }),
        ]);
        const orderMap = new Map(orders.map((o) => [o.id, o]));
        const userMap = new Map(users.map((u) => [u.id, u.name]));
        const projectMap = new Map(projects.map((p) => [p.id, p.name]));
        const unitMap = new Map(units.map((u) => [u.id, u.unitNo]));
        const paymentMap = new Map<string, typeof payments>();
        for (const p of payments)
          paymentMap.set(p.commissionId!, [
            ...(paymentMap.get(p.commissionId!) || []),
            p,
          ]);
        const items = records.map((c) => {
          const order = orderMap.get(c.orderId)!;
          const paid = (paymentMap.get(c.id) || [])
            .filter((p) => p.currency === c.currency)
            .reduce((n, p) => n.add(p.paidAmount), number(0));
          const remaining =
            c.amount === null ? null : number(c.amount).sub(paid);
          return {
            id: c.id,
            commissionNo: c.commissionNo,
            orderId: c.orderId,
            orderNo: order.orderNo,
            salesUserId: c.salesUserId,
            salesName: userMap.get(c.salesUserId) || "历史员工",
            projectName: projectMap.get(order.projectId || ""),
            unitNo: unitMap.get(order.unitId || ""),
            mode: c.mode,
            periodStart: c.periodStart,
            periodEnd: c.periodEnd,
            dueOn: c.dueOn.toISOString().slice(0, 10),
            amount: c.amount?.toFixed(2) ?? null,
            paidAmount: paid.toFixed(2),
            remainingAmount: remaining?.toFixed(2) ?? null,
            currency: c.currency,
            status:
              c.status === "VOID"
                ? "VOID"
                : remaining === null
                  ? "UNSET"
                  : remaining.lte(0)
                    ? "PAID"
                    : paid.gt(0)
                      ? "PARTIAL"
                      : "OPEN",
            ...(id
              ? {
                  remark: c.remark,
                  payments: (paymentMap.get(c.id) || [])
                    .filter((p) => number(p.paidAmount).gt(0))
                    .map((p) => ({
                      expenseNo: p.expenseNo,
                      paidOn: p.paidOn,
                      paidAmount: p.paidAmount.toFixed(2),
                    })),
                }
              : {}),
          };
        });
        return { items, employees: users };
      },
      { isolationLevel: "RepeatableRead" },
    );
  }
  async list(a: Actor, input: unknown) {
    this.allowed(a);
    const q = CompanyCommissionQuery.parse(input);
    if (a.role === "SALES") {
      demand(!q.salesUserId || q.salesUserId === a.id, "只能查看本人的佣金");
      q.salesUserId = a.id;
    }
    const { items, employees } = await this.snapshot(a, q);
    const rows = items.filter(
      (r) =>
        (q.status === "ALL" ||
          (q.status ? r.status === q.status : r.status !== "VOID")) &&
        (!q.q ||
          `${r.commissionNo} ${r.orderNo} ${r.salesName}`
            .toLowerCase()
            .includes(q.q.toLowerCase())),
    );
    const months: string[] = [];
    for (
      let d = new Date(`${q.from.slice(0, 7)}-01`);
      d.toISOString().slice(0, 7) <= q.to.slice(0, 7);
      d.setUTCMonth(d.getUTCMonth() + 1)
    )
      months.push(d.toISOString().slice(0, 7));
    return {
      items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: rows.length,
      employees,
      months,
      summary: commissionTotals(rows),
      trend: months.map((month) => ({
        month,
        ...commissionTotals(rows.filter((r) => r.dueOn.startsWith(month))),
      })),
      staff: employees
        .filter((u) => !q.salesUserId || u.id === q.salesUserId)
        .map((u) => {
          const own = rows.filter((r) => r.salesUserId === u.id);
          return {
            ...u,
            ...commissionTotals(own),
            months: Object.fromEntries(
              months.map((month) => [
                month,
                commissionTotals(own.filter((r) => r.dueOn.startsWith(month)))
                  .amount,
              ]),
            ),
          };
        }),
    };
  }
  async detail(a: Actor, id: string) {
    this.allowed(a);
    const result = await this.snapshot(
      a,
      undefined,
      z.string().uuid().parse(id),
    );
    return result.items[0];
  }
}
