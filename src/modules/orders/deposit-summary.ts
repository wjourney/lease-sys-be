import { number } from "../../common/utils/value";

/** One calculation shared by the order detail and the deposit ledger. */
export function depositSummary(
  order: any,
  receivedValue: any,
  pendingValue: any,
  refunds: any[],
) {
  const received = number(receivedValue),
    pending = number(pendingValue);
  const deduction = number(order.depositDeductionAmount);
  const refunded = refunds.reduce(
    (n, r) => n.add(r.paidAmount ?? 0),
    number(0),
  );
  const refundDue = refunds
    .reduce((n, r) => n.add(r.amount), number(0))
    .sub(refunded);
  const settled = Boolean(order.depositSettledAt);
  const ended = ["COMPLETED", "CLOSED"].includes(order.status);
  const state = settled
    ? refundDue.gt(0)
      ? "REFUND_PENDING"
      : "SETTLED"
    : number(order.depositAmount).lte(0) && received.lte(0) && pending.lte(0)
      ? "NOT_REQUIRED"
      : ended
        ? received.gt(0)
          ? "REFUND_PENDING"
          : "SETTLED"
        : received.gt(0)
          ? "HELD"
          : "UNCOLLECTED";
  return {
    state,
    agreed: order.depositAmount,
    received: received.toFixed(2),
    pending: pending.toFixed(2),
    deduction: deduction.toFixed(2),
    refunded: refunded.toFixed(2),
    refundable: settled ? received.sub(deduction).toFixed(2) : null,
    refundDue: refundDue.toFixed(2),
    held: received.sub(deduction).sub(refunded).toFixed(2),
    // No refund means a completed full deduction: preserve that settlement too.
    canRevise:
      order.status === "COMPLETED" &&
      settled &&
      refunds.length === 1 &&
      refunds[0].status === "UNPAID" &&
      refunded.eq(0) &&
      !(refunds[0].paymentRecords as any[])?.length,
  };
}

export function naturallyExpiredRenewable(order: any, today: Date) {
  return (
    order.status === "COMPLETED" &&
    !order.actualTerminationOn &&
    !order.depositSettledAt &&
    order.endsOn < today
  );
}
