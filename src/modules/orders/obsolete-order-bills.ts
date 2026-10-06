import { number } from "../../common/utils/value";

const billingFields = [
  "startsOn",
  "endsOn",
  "monthlyRent",
  "depositAmount",
  "paymentIntervalMonths",
  "rentDueDay",
  "firstPeriodProration",
  "lastPeriodProration",
];
const same = (a: any, b: any) =>
  JSON.stringify(a ?? null) === JSON.stringify(b ?? null);
/** Only classify equivalent superseded bills when the order audit proves a non-billing edit. */
export function obsoleteOrderBill(old: any, order: any, bills: any[]) {
  if (
    old.deletedAt ||
    old.recordType !== "RECEIVABLE" ||
    old.status !== "VOID" ||
    old.sourceKey ||
    !order
  )
    return null;
  const logs = Array.isArray(old.operationLogs) ? old.operationLogs : [];
  const last = logs.at(-1);
  if (
    last?.reason !== "修改租约，重建未收款账单" ||
    last.changes?.status?.after !== "VOID"
  )
    return null;
  const source = last.changes?.sourceKey?.before;
  if (
    typeof source !== "string" ||
    !(
      source.startsWith(`rent:${old.orderId}:`) ||
      source === `deposit:${old.orderId}`
    )
  )
    return null;
  const time = Date.parse(last.operatedAt);
  const edits = (
    Array.isArray(order.operationLogs) ? order.operationLogs : []
  ).filter(
    (log: any) =>
      log.action === "UPDATE" &&
      log.actorId === last.actorId &&
      Date.parse(log.operatedAt) >= time &&
      Date.parse(log.operatedAt) <= time + 2000,
  );
  if (
    edits.length !== 1 ||
    billingFields.some((field) => field in (edits[0].changes ?? {}))
  )
    return null;
  const replacements = bills.filter(
    (b) =>
      b.id !== old.id &&
      !b.deletedAt &&
      b.status !== "VOID" &&
      b.recordType === "RECEIVABLE" &&
      b.orderId === old.orderId &&
      b.sourceKey === source,
  );
  if (replacements.length !== 1) return null;
  const current = replacements[0];
  if (
    ![
      "feeType",
      "currency",
      "projectId",
      "unitId",
      "periodStart",
      "periodEnd",
      "dueOn",
      "payerName",
      "payerEmail",
      "remark",
    ].every((field) => same(old[field], current[field]))
  )
    return null;
  if (
    !["amount", "adjustmentAmount", "depositOffsetAmount"].every((field) =>
      number(old[field] ?? 0).eq(current[field] ?? 0),
    )
  )
    return null;
  if (
    !number(old.adjustmentAmount ?? 0).eq(0) ||
    !number(old.depositOffsetAmount ?? 0).eq(0)
  )
    return null;
  return {
    id: old.id,
    recordNo: old.recordNo,
    orderId: old.orderId,
    replacementId: current.id,
    replacementNo: current.recordNo,
  };
}
