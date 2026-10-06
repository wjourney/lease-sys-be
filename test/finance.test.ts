import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { movements, totals } from "../src/modules/finance/ledger";
import {
  FinanceQuery,
  FinanceService,
} from "../src/modules/finance/finance.service";
const accountId = "00000000-0000-4000-8000-000000000001";
const projectId = "00000000-0000-4000-8000-000000000002";
const receipt = {
  id: "r",
  recordNo: "RC1",
  recordType: "RECEIPT",
  orderId: "o",
  projectId,
  receivedOn: new Date("2026-10-02"),
  amount: "100.01",
  currency: "HKD",
  feeType: "RENT",
  fundAccountId: accountId,
  payerName: "张",
  status: "CONFIRMED",
};
const expense = {
  id: "e",
  expenseNo: "E1",
  orderId: "o",
  paidOn: new Date("2026-10-03"),
  amount: "60",
  paidAmount: "30",
  currency: "HKD",
  feeType: "DEPOSIT_REFUND",
  fundAccountId: accountId,
  status: "UNPAID",
  paymentRecords: [
    {
      sourceKey: "a",
      amount: "10",
      paidOn: "2026-09-30",
      fundAccountId: "other",
    },
    {
      sourceKey: "b",
      amount: "20",
      paidOn: "2026-10-03",
      fundAccountId: accountId,
    },
  ],
};
test("only confirmed receipts and actual payments enter the ledger; partial refunds never double-count", () => {
  const rows = movements(
    [
      receipt,
      { ...receipt, id: "pending", status: "PENDING" },
      { ...receipt, id: "rejected", status: "REJECTED" },
    ],
    [expense],
  );
  assert.equal(rows.length, 3);
  assert.equal(totals(rows).outgoing, "30.00");
  assert.equal(totals(rows).net, "70.01");
  assert.equal(rows.find((r) => r.id.endsWith(":a"))?.accountId, "other");
});
test("reversal retains original money and a correction dated by audit event, not a later edit", () => {
  const rows = movements(
    [
      {
        ...receipt,
        status: "REVERSED",
        updatedAt: new Date("2026-12-01"),
        operationLogs: [
          {
            operatedAt: "2026-10-31T17:00:00Z",
            changes: { status: { after: "REVERSED" } },
          },
        ],
      },
    ],
    [],
  );
  assert.equal(rows.length, 2);
  assert.equal(rows[0].date, "2026-11-01");
  assert.equal(totals(rows).net, "0.00");
  assert.equal(totals(rows).outgoing, "0.00");
  assert.equal(totals(rows).corrections, "100.01");
});
test("deposits are separated from earned receipts and legacy commission payments count once", () => {
  const rows = movements(
    [receipt, { ...receipt, id: "deposit", feeType: "DEPOSIT", amount: "200" }],
    [
      {
        ...expense,
        id: "commission",
        feeType: "COMMISSION",
        status: "PAID",
        paidAmount: "12.34",
        paymentRecords: [],
      },
    ],
  );
  const sum = totals(rows);
  assert.equal(sum.income, "100.01");
  assert.equal(sum.depositReceived, "200.00");
  assert.equal(sum.commissionPaid, "12.34");
});
test("date ranges reject impossible days, reverse ranges and unbounded queries", () => {
  for (const q of [
    {},
    { from: "2026-02-30", to: "2026-03-01" },
    { from: "2026-10-02", to: "2026-10-01" },
    { from: "2020-01-01", to: "2026-01-01" },
  ])
    assert.equal(FinanceQuery.safeParse(q).success, false);
});
const admin = {
  id: "u",
  role: "FINANCE",
  name: "财务",
  salesCompanyId: null,
  authVersion: 1,
};
function service() {
  const tx: any = {
    income: { findMany: async () => [receipt] },
    expense: { findMany: async () => [expense] },
    fundAccount: {
      findMany: async () => [{ id: accountId, name: "账户", currency: "HKD" }],
    },
    order: {
      findMany: async () => [
        {
          id: "o",
          orderNo: "O1",
          projectId,
          createdAt: new Date("2026-09-30T17:00:00Z"),
        },
      ],
    },
    project: { findMany: async () => [{ id: projectId, name: "项目" }] },
    commission: {
      findMany: async () => [
        { id: "c", orderId: "o", amount: "33" },
        { id: "old", orderId: "o", amount: null },
      ],
    },
  };
  return new FinanceService({ $transaction: async (fn: any) => fn(tx) } as any);
}
test("server paging and filters operate on individual movements with totals across all matching pages", async () => {
  const result = await service().ledger(admin, {
    from: "2026-10-01",
    to: "2026-10-31",
    pageSize: 1,
    accountId,
  });
  assert.equal(result.total, 2);
  assert.equal(result.items.length, 1);
  assert.equal(result.summary.net, "80.01");
  const outgoing = await service().ledger(admin, {
    from: "2026-09-01",
    to: "2026-10-31",
    direction: "OUT",
    q: "E1",
  });
  assert.equal(outgoing.total, 2);
  assert.equal(outgoing.summary.outgoing, "30.00");
});
test("statistics match ledger for the same window and treat missing historical commissions separately", async () => {
  const result = await service().statistics(admin, {
    from: "2026-10-01",
    to: "2026-10-31",
  });
  assert.equal(result.summary.orderCount, 1);
  assert.equal(result.summary.commissionCount, 2);
  assert.equal(result.summary.commissionDue, "33.00");
  assert.equal(result.summary.unsetCommissionCount, 1);
  assert.equal(result.summary.net, "80.01");
  assert.equal(result.trend[0].net, "80.01");
});
test("non-finance actors cannot read financial aggregates", async () => {
  await assert.rejects(
    service().ledger(
      { ...admin, role: "SALES" },
      { from: "2026-10-01", to: "2026-10-31" },
    ),
  );
  await assert.rejects(
    service().statistics(
      { ...admin, role: "OPERATIONS" },
      { from: "2026-10-01", to: "2026-10-31" },
    ),
  );
});
