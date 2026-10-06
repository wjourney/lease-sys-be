import assert from "node:assert/strict";
import { test } from "node:test";
import { obsoleteOrderBill } from "../src/modules/orders/obsolete-order-bills";
function fixture() {
  const old: any = {
    id: "old",
    orderId: "order",
    recordNo: "B1",
    recordType: "RECEIVABLE",
    status: "VOID",
    sourceKey: null,
    feeType: "RENT",
    amount: "100",
    operationLogs: [
      {
        reason: "修改租约，重建未收款账单",
        actorId: "admin",
        operatedAt: "2026-10-04T00:00:00.000Z",
        changes: {
          status: { before: "OPEN", after: "VOID" },
          sourceKey: { before: "rent:order:2026-10-01", after: null },
        },
      },
    ],
  };
  const order: any = {
    operationLogs: [
      {
        action: "UPDATE",
        actorId: "admin",
        operatedAt: "2026-10-04T00:00:00.100Z",
        changes: { remark: { before: "", after: "备注" } },
      },
    ],
  };
  const current = {
    ...old,
    id: "current",
    recordNo: "B2",
    status: "OPEN",
    sourceKey: "rent:order:2026-10-01",
  };
  return { old, order, current };
}
test("cleanup classifies only audit-proven equivalent superseded bills", () => {
  const f = fixture();
  assert.equal(
    obsoleteOrderBill(f.old, f.order, [f.old, f.current])?.replacementId,
    "current",
  );
  f.old.deletedAt = new Date();
  assert.equal(obsoleteOrderBill(f.old, f.order, [f.current]), null);
});
test("cleanup preserves legitimate billing changes and uncertain audit history", () => {
  const f = fixture();
  f.order.operationLogs[0].changes.monthlyRent = { before: "90", after: "100" };
  assert.equal(obsoleteOrderBill(f.old, f.order, [f.current]), null);
  f.order.operationLogs = [];
  assert.equal(obsoleteOrderBill(f.old, f.order, [f.current]), null);
});
test("cleanup never guesses a replacement when terms differ, are missing, or duplicated", () => {
  const f = fixture();
  assert.equal(obsoleteOrderBill(f.old, f.order, []), null);
  assert.equal(
    obsoleteOrderBill(f.old, f.order, [
      f.current,
      { ...f.current, id: "another" },
    ]),
    null,
  );
  assert.equal(
    obsoleteOrderBill(f.old, f.order, [{ ...f.current, amount: "101" }]),
    null,
  );
  assert.equal(
    obsoleteOrderBill(f.old, f.order, [{ ...f.current, status: "VOID" }]),
    null,
  );
});
