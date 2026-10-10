import { z } from "zod";
import { number } from "../../common/utils/value";

const day = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => {
    const d = new Date(s);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
  });
export const BillQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    orderId: z.string().uuid().optional(),
    projectId: z.string().uuid().optional(),
    unitId: z.string().uuid().optional(),
    feeType: z.enum(["RENT", "DEPOSIT", "OTHER"]).optional(),
    status: z.enum(["OPEN", "PARTIAL", "PAID", "VOID", "ALL"]).optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default("HKD"),
    overdue: z.enum(["true", "false"]).optional(),
    pending: z.enum(["true", "false"]).optional(),
    from: day.optional(),
    to: day.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(12),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "结束日期不能早于开始日期",
  );

export function billAmounts(
  b: any,
  sums: { confirmed?: any; pending?: any } = {},
  today = new Date().toISOString().slice(0, 10),
) {
  const total = number(b.amount).add(b.adjustmentAmount ?? 0);
  const confirmed = number(sums.confirmed ?? 0),
    pending = number(sums.pending ?? 0);
  const offset = number(b.depositOffsetAmount ?? 0);
  const remaining = total.sub(confirmed).sub(offset);
  const status =
    b.status === "VOID" ? "VOID" : remaining.lte(0) ? "PAID" : "OPEN";
  return {
    total: total.toFixed(2),
    confirmed: confirmed.toFixed(2),
    pending: pending.toFixed(2),
    offset: offset.toFixed(2),
    remaining: remaining.toFixed(2),
    available: remaining.sub(pending).toFixed(2),
    status,
    overdue:
      status !== "VOID" &&
      remaining.gt(0) &&
      !!b.dueOn &&
      b.dueOn.toISOString().slice(0, 10) < today,
  };
}

export function summarizeBills(rows: any[]) {
  const group = (deposit: boolean) => {
    const items = rows.filter(
      (b) => b.status !== "VOID" && (b.feeType === "DEPOSIT") === deposit,
    );
    return Object.fromEntries(
      ["total", "confirmed", "pending", "offset", "remaining"].map((key) => [
        key,
        items.reduce((n, b) => n.add(b[key]), number(0)).toFixed(2),
      ]),
    );
  };
  return { rental: group(false), deposit: group(true) };
}

/** Explain the same balance/lifecycle restrictions used by receipt registration. */
export function billRegistration(bill: any, order: any) {
  const registrationBlockedReason = !order || order.deletedAt
    ? "关联订单不存在，无法登记收款"
    : bill.status === "VOID" ? "账单已失效，无法登记收款"
    : order.status === "CLOSED" ? "订单已关闭，无法登记收款"
    : bill.feeType === "DEPOSIT" && order.depositSettledAt ? "押金已结算，无法继续登记收款"
    : Number(bill.remaining) <= 0 ? "账单已付清，无需重复登记"
    : Number(bill.pending) > 0
      ? "已有收款记录待处理，请在账单详情的收款记录中核对，避免重复登记"
    : !(Number(bill.available) > 0) ? "账单暂无可登记余额"
    : null;
  return { canRegister: registrationBlockedReason === null, registrationBlockedReason };
}
