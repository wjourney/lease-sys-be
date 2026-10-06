import { number } from "../../common/utils/value";

/** Computed from source records: ending a tenancy does not mean money is settled. */
export function orderSettlement(
  order: any,
  bills: any[],
  receipts: any[],
  expenses: any[],
  commissions: any[],
) {
  const outstanding = bills
    .filter(
      (b) =>
        b.status !== "VOID" &&
        !(b.feeType === "DEPOSIT" && order.depositSettledAt),
    )
    .filter((b) => {
      const paid = receipts
        .filter((r) => r.parentId === b.id && r.status === "CONFIRMED")
        .reduce((n, r) => n.add(r.amount), number(0));
      return number(b.amount)
        .add(b.adjustmentAmount ?? 0)
        .sub(b.depositOffsetAmount ?? 0)
        .sub(paid)
        .gt(0);
    });
  const pending = receipts.filter((r) => r.status === "PENDING").length;
  const unpaid = expenses.filter(
    (e) =>
      e.status !== "VOID" &&
      number(e.amount)
        .sub(e.paidAmount ?? 0)
        .gt(0),
  );
  const commissionsDue = commissions.filter(
    (c) =>
      c.status !== "VOID" &&
      (c.amount == null ||
        expenses
          .filter((e) => e.commissionId === c.id && e.status !== "VOID")
          .reduce((n, e) => n.add(e.paidAmount ?? 0), number(0))
          .lt(c.amount)),
  ).length;
  const blockers = [
    ...(order.handoverStatus !== "DONE" ? ["单位尚未交还"] : []),
    ...(outstanding.length ? [`${outstanding.length} 笔账单未结清`] : []),
    ...(pending ? [`${pending} 笔收款待核对`] : []),
    ...(!order.depositSettledAt ? ["押金尚未结算"] : []),
    ...(unpaid.length ? [`${unpaid.length} 笔付款单未付清`] : []),
    ...(commissionsDue ? [`${commissionsDue} 笔佣金未结清`] : []),
  ];
  return {
    complete: order.status === "COMPLETED" && blockers.length === 0,
    blockers,
  };
}
