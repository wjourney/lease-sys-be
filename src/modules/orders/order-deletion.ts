import { fail } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { update } from "../../common/database/record-mutations";
import type { Actor } from "../../common/auth/actor";
export async function orderDeletionGraph(tx: any, orderId: string) {
  const commissions = await tx.commission.findMany({ where: { orderId, deletedAt: null } });
  const roots = await tx.income.findMany({ where: { orderId, deletedAt: null } });
  const incomes = await tx.income.findMany({ where: { deletedAt: null, OR: [{ orderId }, { parentId: { in: roots.map((r: any) => r.id) } }] } });
  const expenses = await tx.expense.findMany({ where: { deletedAt: null, OR: [{ orderId }, { commissionId: { in: commissions.map((r: any) => r.id) } }, { originalIncomeId: { in: incomes.map((r: any) => r.id) } }] } });
  const invoices = await tx.invoice.findMany({ where: { incomeId: { in: incomes.map((r: any) => r.id) }, deletedAt: null } });
  const materials = await tx.material.findMany({ where: { deletedAt: null, OR: [{ orderId }, { incomeId: { in: incomes.map((r: any) => r.id) } }, { expenseId: { in: expenses.map((r: any) => r.id) } }, { invoiceId: { in: invoices.map((r: any) => r.id) } }] } });
  const blocked = incomes.some((r: any) => r.recordType === "RECEIPT" && (r.status === "CONFIRMED" || (r.confirmedAt && r.status !== "REVERSED"))) || expenses.some((r: any) => number(r.paidAmount).gt(0) || r.paymentRecords?.length) || incomes.some((r: any) => number(r.depositOffsetAmount).gt(0));
  return { incomes, commissions, expenses, invoices, materials, blocked };
}
export function deletionSummary(graph: Awaited<ReturnType<typeof orderDeletionGraph>>) {
  return { allowed: !graph.blocked, reason: graph.blocked ? "已有实际收付款或押金抵扣，请先处理关联资金记录，不能直接删除订单及资金记录" : "",
    bills: graph.incomes.filter((r: any) => r.recordType === "RECEIVABLE").length,
    receipts: graph.incomes.filter((r: any) => r.recordType === "RECEIPT").length,
    commissions: graph.commissions.length, expenses: graph.expenses.length,
    invoices: graph.invoices.length, materials: graph.materials.length };
}
export async function deleteOrderGraph(tx: any, actor: Actor, order: any, reason: string) {
  const graph = await orderDeletionGraph(tx, order.id);
  if (graph.blocked) fail(deletionSummary(graph).reason);
  const deletion = { deletedAt: new Date(), deletedBy: actor.id };
  for (const resource of ["materials", "invoices", "expenses", "incomes", "commissions"] as const)
    for (const row of graph[resource])
      await update(tx, resource, row, { ...deletion, ...(resource === "incomes" ? { nextGenerationOn: null } : {}) }, actor, `删除订单 ${order.orderNo}：${reason}`);
  return update(tx, "orders", order, { ...deletion, status: "CLOSED", occupancyState: "RELEASED", nextBillOn: null }, actor, reason);
}
