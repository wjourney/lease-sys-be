import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Actor, financial } from "../../common/auth/actor";
import { demand } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { businessDay, movements, totals } from "./ledger";

const day = z.iso.date();
export const FinanceQuery = z
  .object({
    from: day,
    to: day,
    currency: z.enum(["HKD", "CNY", "USD"]).default("HKD"),
    accountId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    orderId: z.string().uuid().optional(),
    direction: z.enum(["IN", "OUT"]).optional(),
    kind: z.enum(["RECEIPT", "PAYMENT", "REVERSAL"]).optional(),
    feeType: z.string().max(40).optional(),
    q: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(12),
  })
  .strict()
  .refine((q) => q.from <= q.to, "开始日期不能晚于结束日期")
  .refine(
    (q) => (Date.parse(q.to) - Date.parse(q.from)) / 86400000 <= 1096,
    "时间范围不能超过三年",
  );

@Injectable()
export class FinanceService {
  constructor(@Inject(PrismaService) readonly db: PrismaService) {}

  private async snapshot(a: Actor, input: any) {
    demand(financial(a));
    const q = FinanceQuery.parse(input);
    // One consistent read snapshot: paging and totals always refer to the same set of money movements.
    const data = await this.db.$transaction(async (tx) => {
      const [receipts, expenses, accounts, orders, projects, commissions] =
        await Promise.all([
          tx.income.findMany({
            where: {
              OR: [{ deletedAt: null }, { status: "REVERSED" }],
              recordType: "RECEIPT",
              currency: q.currency,
              status: { in: ["CONFIRMED", "REVERSED"] },
            },
            select: {
              id: true,
              recordNo: true,
              orderId: true,
              projectId: true,
              receivedOn: true,
              amount: true,
              currency: true,
              feeType: true,
              fundAccountId: true,
              payerName: true,
              bankReference: true,
              status: true,
              operationLogs: true,
              updatedAt: true,
            },
          }),
          tx.expense.findMany({
            where: {
              deletedAt: null,
              currency: q.currency,
              paidAmount: { gt: 0 },
              status: { not: "VOID" },
            },
            select: {
              id: true,
              expenseNo: true,
              orderId: true,
              projectId: true,
              commissionId: true,
              paidOn: true,
              amount: true,
              paidAmount: true,
              paymentRecords: true,
              currency: true,
              feeType: true,
              fundAccountId: true,
              payeeName: true,
              bankReference: true,
              status: true,
            },
          }),
          tx.fundAccount.findMany({
            select: { id: true, name: true, currency: true },
          }),
          tx.order.findMany({
            where: { deletedAt: null },
            select: {
              id: true,
              orderNo: true,
              status: true,
              projectId: true,
              createdAt: true,
            },
          }),
          tx.project.findMany({ select: { id: true, name: true } }),
          tx.commission.findMany({
            where: {
              deletedAt: null,
              status: { not: "VOID" },
              currency: q.currency,
              dueOn: { gte: new Date(q.from), lte: new Date(q.to) },
            },
            select: { id: true, orderId: true, amount: true },
          }),
        ]);
      return { receipts, expenses, accounts, orders, projects, commissions };
    });
    const orders = new Map(data.orders.map((o) => [o.id, o]));
    const projects = new Map(data.projects.map((p) => [p.id, p.name]));
    const accounts = new Map(data.accounts.map((v) => [v.id, v.name]));
    const rows = movements(data.receipts, data.expenses)
      .map((r) => {
        const order = r.orderId ? orders.get(r.orderId) : undefined;
        const projectId = r.projectId || order?.projectId;
        return {
          ...r,
          projectId,
          orderNo: order?.orderNo || "",
          projectName: projectId ? projects.get(projectId) || "" : "",
          accountName: r.accountId
            ? accounts.get(r.accountId) || "历史账户"
            : "未记录账户",
        };
      })
      .filter(
        (r) =>
          r.date >= q.from &&
          r.date <= q.to &&
          (!q.accountId || r.accountId === q.accountId) &&
          (!q.projectId || r.projectId === q.projectId) &&
          (!q.orderId || r.orderId === q.orderId) &&
          (!q.direction || r.direction === q.direction) &&
          (!q.kind || r.kind === q.kind) &&
          (!q.feeType || r.feeType === q.feeType) &&
          (!q.q ||
            [
              r.sourceNo,
              r.orderNo,
              r.counterparty,
              r.bankReference,
              r.projectName,
              r.accountName,
            ]
              .join(" ")
              .toLowerCase()
              .includes(q.q.toLowerCase())),
      );
    return { q, data, rows, orders };
  }
  async ledger(a: Actor, input: any) {
    const { q, data, rows } = await this.snapshot(a, input);
    return {
      items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
      total: rows.length,
      page: q.page,
      pageSize: q.pageSize,
      summary: totals(rows),
      accounts: data.accounts.filter((x) => x.currency === q.currency),
      projects: data.projects,
    };
  }
  async statistics(a: Actor, input: any) {
    // These extra ledger-only filters would otherwise make order / commission counts misleading.
    const query = FinanceQuery.parse(input);
    demand(
      !query.accountId &&
        !query.direction &&
        !query.kind &&
        !query.feeType &&
        !query.q,
    );
    const { q, data, rows, orders } = await this.snapshot(a, input);
    const selectedOrders = data.orders.filter(
      (o) =>
        o.status !== "DRAFT" &&
        (!q.projectId || o.projectId === q.projectId) &&
        (!q.orderId || o.id === q.orderId) &&
        businessDay(o.createdAt) >= q.from &&
        businessDay(o.createdAt) <= q.to,
    );
    const commissions = data.commissions.filter(
      (c) =>
        (!q.projectId || orders.get(c.orderId)?.projectId === q.projectId) &&
        (!q.orderId || c.orderId === q.orderId),
    );
    const months: string[] = [];
    let month = q.from.slice(0, 7);
    while (month <= q.to.slice(0, 7)) {
      months.push(month);
      const d = new Date(`${month}-01T00:00:00Z`);
      d.setUTCMonth(d.getUTCMonth() + 1);
      month = d.toISOString().slice(0, 7);
    }
    const grouped = new Map<string, typeof rows>();
    for (const row of rows.filter((r) => r.kind === "PAYMENT"))
      grouped.set(row.feeType, [...(grouped.get(row.feeType) || []), row]);
    return {
      currency: q.currency,
      from: q.from,
      to: q.to,
      summary: {
        ...totals(rows),
        orderCount: selectedOrders.length,
        commissionCount: commissions.length,
        commissionDue: commissions
          .reduce((n, c) => n.add(c.amount ?? 0), number(0))
          .toFixed(2),
        unsetCommissionCount: commissions.filter((c) => c.amount === null)
          .length,
      },
      trend: months.map((month) => ({
        month,
        ...totals(rows.filter((r) => r.date.startsWith(month))),
        orderCount: selectedOrders.filter((o) =>
          businessDay(o.createdAt).startsWith(month),
        ).length,
      })),
      expenses: [...grouped].map(([feeType, values]) => ({
        feeType,
        amount: totals(values).outgoing,
      })),
      projects: data.projects,
    };
  }
}
