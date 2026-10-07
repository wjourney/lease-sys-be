import assert from "node:assert/strict";
import { test } from "node:test";
import { billInvoiceCounts } from "../src/modules/invoices/bill-invoice-counts";

test("invoice availability counts active invoices on confirmed receipts only, across the current bill page", async () => {
  const db: any = {
    income: {
      findMany: async ({ where, select }: any) => {
        assert.deepEqual(where, {
          parentId: { in: ["b1", "b2", "b3"] },
          recordType: "RECEIPT",
          status: "CONFIRMED",
          deletedAt: null,
        });
        assert.deepEqual(select, { id: true, parentId: true });
        return [
          { id: "r1", parentId: "b1" },
          { id: "r2", parentId: "b1" },
          { id: "r3", parentId: "b2" },
        ];
      },
    },
    invoice: {
      groupBy: async ({ where, by }: any) => {
        assert.deepEqual(where, {
          incomeId: { in: ["r1", "r2", "r3"] },
          status: "ACTIVE",
          deletedAt: null,
        });
        assert.deepEqual(by, ["incomeId"]);
        return [
          { incomeId: "r1", _count: { _all: 1 } },
          { incomeId: "r2", _count: { _all: 1 } },
          { incomeId: "r3", _count: { _all: 1 } },
        ];
      },
    },
  };
  assert.deepEqual(
    [...(await billInvoiceCounts(db, ["b1", "b2", "b3"]))],
    [
      ["b1", 2],
      ["b2", 1],
    ],
  );
  assert.equal((await billInvoiceCounts({}, [])).size, 0);
  assert.equal(
    (await billInvoiceCounts({ income: { findMany: async () => [] } }, ["b1"]))
      .size,
    0,
  );
});
