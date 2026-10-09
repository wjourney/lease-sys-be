import { loadBillTitles } from "./bill-title";
import { billInvoiceCounts } from "../invoices/bill-invoice-counts";
import { Actor } from "../../common/auth/actor";
import {
  BillQuery,
  billAmounts,
  billRegistration,
  summarizeBills,
} from "./bill-query";

/** A consistent read model shared by the table and its unpaginated totals. */
export async function listOrderBills(
  db: any,
  access: any,
  actor: Actor,
  query: unknown,
) {
  access.allow(actor, "incomes");
  const q = BillQuery.parse(query);
  return db.$transaction(
    async (tx: any) => {
      const scope = await access.scope(actor, "incomes", tx);
      const orders = await tx.order.findMany({
        where: {
          AND: [{ deletedAt: null }, await access.scope(actor, "orders", tx)],
        },
        select: {
          id: true,
          orderNo: true,
          tenantName: true,
          projectId: true,
          unitId: true,
          status: true,
          depositSettledAt: true,
        },
      });
      const orderIds = orders.map((o: any) => o.id);
      const orderMap = new Map<string, any>(orders.map((o: any) => [o.id, o]));
      const base = {
        deletedAt: null,
        recordType: "RECEIVABLE",
        orderId: { in: orderIds },
        currency: q.currency,
      };
      const and: any[] = [base, scope];
      if (q.orderId) and.push({ orderId: q.orderId });
      if (q.projectId) and.push({ projectId: q.projectId });
      if (q.unitId) and.push({ unitId: q.unitId });
      if (q.feeType) and.push({ feeType: q.feeType });
      if (q.status === "VOID") and.push({ status: "VOID" });
      else if (q.status !== "ALL") and.push({ status: { not: "VOID" } });
      if (q.from || q.to)
        and.push({
          dueOn: {
            ...(q.from ? { gte: new Date(q.from) } : {}),
            ...(q.to ? { lte: new Date(q.to) } : {}),
          },
        });
      if (q.q) {
        const word = q.q.toLocaleLowerCase();
        const matching = orders.filter((o: any) =>
          `${o.orderNo} ${o.tenantName}`.toLocaleLowerCase().includes(word),
        );
        and.push({
          OR: [
            { recordNo: { contains: q.q } },
            { payerName: { contains: q.q } },
            { orderId: { in: matching.map((o: any) => o.id) } },
          ],
        });
      }
      // Select only fields used by this screen; do not load audit JSON for every bill.
      const bills = await tx.income.findMany({
        where: { AND: and },
        select: {
          id: true,
          recordNo: true,
          recordType: true,
          orderId: true,
          projectId: true,
          unitId: true,
          feeType: true,
          currency: true,
          payerName: true,
          periodStart: true,
          periodEnd: true,
          dueOn: true,
          amount: true,
          adjustmentAmount: true,
          depositOffsetAmount: true,
          status: true,
        },
      });
      const [groups, projects, units, pendingCount] = await Promise.all([
        tx.income.groupBy({
          by: ["parentId", "status"],
          where: {
            parentId: { in: bills.map((b: any) => b.id) },
            deletedAt: null,
            recordType: "RECEIPT",
            status: { in: ["PENDING", "CONFIRMED"] },
          },
          _sum: { amount: true },
        }),
        tx.project.findMany({
          where: {
            id: {
              in: [
                ...new Set(orders.map((o: any) => o.projectId).filter(Boolean)),
              ],
            },
          },
          select: { id: true, name: true },
        }),
        tx.unit.findMany({
          where: {
            id: {
              in: [
                ...new Set(orders.map((o: any) => o.unitId).filter(Boolean)),
              ],
            },
          },
          select: { id: true, projectId: true, unitNo: true },
        }),
        tx.income.count({
          where: {
            AND: [
              scope,
              {
                deletedAt: null,
                recordType: "RECEIPT",
                orderId: { in: orderIds },
                currency: q.currency,
                status: "PENDING",
              },
            ],
          },
        }),
      ]);
      const sums = new Map<string, any>();
      for (const g of groups) {
        const value = sums.get(g.parentId) || {};
        value[g.status === "PENDING" ? "pending" : "confirmed"] = g._sum.amount;
        sums.set(g.parentId, value);
      }
      const projectMap = new Map(projects.map((p: any) => [p.id, p.name]));
      const unitMap = new Map(units.map((u: any) => [u.id, u.unitNo]));
      const rows = bills
        .map((b: any) => ({ ...b, ...billAmounts(b, sums.get(b.id)) }))
        .filter(
          (b: any) =>
            (!q.status || q.status === "ALL" || b.status === q.status) &&
            (q.overdue !== "true" || b.overdue) &&
            (q.pending !== "true" || Number(b.pending) > 0),
        );
      rows.sort((a: any, b: any) => {
        const rank = (s: string) =>
          ["OPEN", "PARTIAL"].includes(s) ? 0 : s === "PAID" ? 1 : 2;
        return (
          rank(a.status) - rank(b.status) ||
          (a.dueOn?.getTime() ?? Infinity) - (b.dueOn?.getTime() ?? Infinity) ||
          a.recordNo.localeCompare(b.recordNo)
        );
      });
      const pageRows = rows.slice(
        (q.page - 1) * q.pageSize,
        q.page * q.pageSize,
      );
      const titleFor = await loadBillTitles(tx, pageRows);
      const invoiceCounts = await billInvoiceCounts(
        tx,
        pageRows.filter((b: any) => b.status !== "VOID").map((b: any) => b.id),
      );
      const items = pageRows.map((b: any) => {
        const order = orderMap.get(b.orderId);
        return {
          ...b,
          ...titleFor(b),
          orderNo: order.orderNo,
          projectName: projectMap.get(b.projectId),
          unitNo: unitMap.get(b.unitId),
          ...billRegistration(b, order),
          invoiceCount: invoiceCounts.get(b.id) || 0,
        };
      });
      return {
        items,
        total: rows.length,
        page: q.page,
        pageSize: q.pageSize,
        summary: summarizeBills(rows),
        pendingCount,
        projects,
        units,
      };
    },
    { isolationLevel: "RepeatableRead", timeout: 20000 },
  );
}
