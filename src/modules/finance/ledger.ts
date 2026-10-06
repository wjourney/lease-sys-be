import { number } from "../../common/utils/value";

export type Movement = {
  id: string;
  sourceId: string;
  source: "incomes" | "expenses";
  sourceNo: string;
  orderId: string | null;
  commissionId?: string | null;
  date: string;
  direction: "IN" | "OUT";
  kind: "RECEIPT" | "PAYMENT" | "REVERSAL";
  amount: string;
  currency: string;
  feeType: string;
  accountId: string | null;
  counterparty: string;
  bankReference: string;
  orderNo?: string;
  projectId?: string | null;
  projectName?: string;
  accountName?: string;
};
const dateOnly = (v: any) =>
  v instanceof Date
    ? v.toISOString().slice(0, 10)
    : String(v ?? "").slice(0, 10);
// Business timestamps use Hong Kong's calendar day; date-only payment fields are stored as UTC DATE.
export const businessDay = (v: any) =>
  new Date(new Date(v).getTime() + 8 * 3600000).toISOString().slice(0, 10);

export function movements(receipts: any[], expenses: any[]): Movement[] {
  const rows: Movement[] = [];
  for (const r of receipts) {
    if (!["CONFIRMED", "REVERSED"].includes(r.status)) continue;
    const entry: Movement = {
      id: `receipt:${r.id}`,
      sourceId: r.id,
      source: "incomes",
      sourceNo: r.recordNo,
      orderId: r.orderId,
      projectId: r.projectId,
      date: dateOnly(r.receivedOn),
      direction: "IN",
      kind: "RECEIPT",
      amount: number(r.amount).toFixed(2),
      currency: r.currency,
      feeType: r.feeType,
      accountId: r.fundAccountId,
      counterparty: r.payerName || "",
      bankReference: r.bankReference || "",
    };
    rows.push(entry);
    // A correction is not an actual refund. Retain the original entry and show its opposite separately.
    if (r.status === "REVERSED") {
      const log = [...(Array.isArray(r.operationLogs) ? r.operationLogs : [])]
        .reverse()
        .find((x: any) => x.changes?.status?.after === "REVERSED");
      rows.push({
        ...entry,
        id: `reversal:${r.id}`,
        direction: "OUT",
        kind: "REVERSAL",
        date: businessDay(log?.operatedAt || r.updatedAt),
      });
    }
  }
  for (const e of expenses) {
    if (e.status === "VOID" || number(e.paidAmount).lte(0)) continue;
    const records = Array.isArray(e.paymentRecords) ? e.paymentRecords : [];
    // Each partial refund is a separate movement. Legacy commission payments have no paymentRecords.
    const payments = records.length
      ? records
      : [{ ...e, amount: e.paidAmount }];
    payments.forEach((p: any, index: number) => {
      if (number(p.amount).lte(0)) return;
      rows.push({
        id: `payment:${e.id}:${p.sourceKey || index}`,
        sourceId: e.id,
        source: "expenses",
        sourceNo: e.expenseNo,
        orderId: e.orderId,
        projectId: e.projectId,
        commissionId: e.commissionId,
        date: dateOnly(p.paidOn),
        direction: "OUT",
        kind: "PAYMENT",
        amount: number(p.amount).toFixed(2),
        currency: e.currency,
        feeType: e.feeType,
        accountId: p.fundAccountId,
        counterparty: e.payeeName || "",
        bankReference: p.bankReference || "",
      });
    });
  }
  return rows.sort(
    (a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id),
  );
}

export function totals(rows: Movement[]) {
  const sum = (test: (r: Movement) => boolean) =>
    rows.filter(test).reduce((n, r) => n.add(r.amount), number(0));
  const incoming = sum((r) => r.direction === "IN");
  const outgoing = sum((r) => r.kind === "PAYMENT");
  const corrections = sum((r) => r.kind === "REVERSAL");
  return {
    incoming: incoming.toFixed(2),
    outgoing: outgoing.toFixed(2),
    corrections: corrections.toFixed(2),
    net: incoming.sub(outgoing).sub(corrections).toFixed(2),
    income: sum((r) => r.direction === "IN" && r.feeType !== "DEPOSIT")
      .sub(sum((r) => r.kind === "REVERSAL" && r.feeType !== "DEPOSIT"))
      .toFixed(2),
    depositReceived: sum((r) => r.direction === "IN" && r.feeType === "DEPOSIT")
      .sub(sum((r) => r.kind === "REVERSAL" && r.feeType === "DEPOSIT"))
      .toFixed(2),
    depositRefunded: sum(
      (r) => r.kind === "PAYMENT" && r.feeType === "DEPOSIT_REFUND",
    ).toFixed(2),
    commissionPaid: sum(
      (r) => r.kind === "PAYMENT" && r.feeType === "COMMISSION",
    ).toFixed(2),
  };
}
