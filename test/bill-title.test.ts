import assert from "node:assert/strict";
import { test } from "node:test";
import { billTitles, loadBillTitles } from "../src/modules/incomes/bill-title";
const bill = (start: string, end = "2026-11-08", extra = {}) => ({
  orderId: "o",
  feeType: "RENT",
  periodStart: start,
  periodEnd: end,
  ...extra,
});
test("installments follow full order history, excluding deposits and deduplicating replacements", () => {
  const one = bill("2026-10-09"),
    two = bill("2026-11-09", "2026-12-08");
  const history = [
    two,
    bill("2026-09-09", undefined, { feeType: "DEPOSIT" }),
    one,
    { ...one, status: "VOID" },
    bill("2026-09-01", undefined, { orderId: "other" }),
  ];
  const title = billTitles(history);
  assert.equal(title(one).billTitle, "一期租金—2026-10-09 至 2026-11-08");
  assert.equal(title(two).rentInstallment, 2);
  assert.equal(title(two).billTitle, "二期租金—2026-11-09 至 2026-12-08");
  assert.equal(title({ feeType: "DEPOSIT" }).billTitle, "押金");
});
test("paged and filtered reads query complete authorized order periods once, including void history", async () => {
  const history = Array.from({ length: 13 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 9 + index, 9));
    const end = new Date(Date.UTC(2026, 10 + index, 8));
    return { ...bill(date.toISOString()), periodStart: date, periodEnd: end };
  });
  let reads = 0;
  const title = await loadBillTitles(
    {
      income: {
        findMany: async (args: any) => {
          reads++;
          assert.deepEqual(args.where, {
            orderId: { in: ["o"] },
            recordType: "RECEIVABLE",
            feeType: "RENT",
            deletedAt: null,
          });
          return history;
        },
      },
    },
    [history[12]],
  );
  assert.equal(reads, 1);
  assert.equal(title(history[12]).rentInstallment, 13);
  assert.equal(
    title(history[12]).billTitle,
    "十三期租金—2027-10-09 至 2027-11-08",
  );
});
