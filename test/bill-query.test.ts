import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  billAmounts,
  BillQuery,
  summarizeBills,
} from "../src/modules/incomes/bill-query";
import { listOrderBills } from "../src/modules/incomes/bill-list";

test("pending money reserves registration balance but does not settle an overdue bill", () => {
  const result = billAmounts(
    {
      amount: "100.10",
      adjustmentAmount: "0.20",
      dueOn: new Date("2026-10-01"),
    },
    { confirmed: "20.10", pending: "30.10" },
    "2026-10-06",
  );
  assert.deepEqual(result, {
    total: "100.30",
    confirmed: "20.10",
    pending: "30.10",
    offset: "0.00",
    remaining: "80.20",
    available: "50.10",
    status: "PARTIAL",
    overdue: true,
  });
});
test("deposit offsets settle bills without being counted as confirmed cash", () => {
  const result = billAmounts(
    {
      amount: "100",
      depositOffsetAmount: "100",
      status: "OPEN",
      dueOn: new Date("2026-10-01"),
    },
    {},
    "2026-10-06",
  );
  assert.equal(result.status, "PAID");
  assert.equal(result.confirmed, "0.00");
  assert.equal(result.remaining, "0.00");
  assert.equal(result.overdue, false);
  assert.equal(
    billAmounts({
      amount: "100",
      status: "VOID",
      dueOn: new Date("2026-10-01"),
    }).overdue,
    false,
  );
});
test("summaries separate held deposits, include adjustments and exclude void bills", () => {
  const bill = (amount: string, feeType: string, status = "OPEN") => ({
    feeType,
    ...billAmounts({ amount, status }),
  });
  const result = summarizeBills([
    bill("0.10", "RENT"),
    bill("0.20", "OTHER"),
    bill("90", "DEPOSIT"),
    bill("900", "RENT", "VOID"),
  ]);
  assert.equal(result.rental.total, "0.30");
  assert.equal(result.deposit.total, "90.00");
});
test("query rejects invalid dates, ids, currency and reversed periods", () => {
  for (const q of [
    { from: "2026-02-30" },
    { from: "2026-10-02", to: "2026-10-01" },
    { projectId: "all" },
    { currency: "HKD,CNY" },
    { status: "PENDING" },
    { pageSize: 1000 },
  ])
    assert.equal(BillQuery.safeParse(q).success, false);
});

test("bill list keeps authorized scope, totals all pages, sorts open bills first, and filters pending separately", async () => {
  const actor: any = { id: "staff", role: "SALES" };
  const orders = [
    {
      id: "o",
      orderNo: "R1",
      tenantName: "张",
      projectId: "p",
      unitId: "u",
      status: "ACTIVE",
    },
  ];
  const roots = Array.from({ length: 14 }, (_, i) => ({
    id: String(i),
    recordNo: `B${i.toString().padStart(2, "0")}`,
    orderId: "o",
    projectId: "p",
    unitId: "u",
    recordType: "RECEIVABLE",
    status: "OPEN",
    feeType: "RENT",
    amount: "10",
    currency: "HKD",
    dueOn: new Date(`2026-10-${String(i + 1).padStart(2, "0")}`),
  }));
  let where: any;
  const tx = {
    order: {
      findMany: async (args: any) => {
        assert.deepEqual(args.where.AND[1], { id: { in: ["o"] } });
        return orders;
      },
    },
    project: { findMany: async () => [{ id: "p", name: "项目" }] },
    unit: {
      findMany: async () => [{ id: "u", projectId: "p", unitNo: "101" }],
    },
    income: {
      findMany: async (args: any) => {
        where = args.where;
        return roots;
      },
      groupBy: async () => [
        { parentId: "0", status: "CONFIRMED", _sum: { amount: "10" } },
        { parentId: "1", status: "PENDING", _sum: { amount: "5" } },
      ],
      count: async () => 1,
    },
  };
  const db = { $transaction: async (fn: any) => fn(tx) };
  const access = {
    allow: () => {},
    scope: async (_: any, r: string) =>
      r === "orders" ? { id: { in: ["o"] } } : { orderId: { in: ["o"] } },
  };
  const result = await listOrderBills(db, access, actor, { pageSize: 12 });
  assert.equal(result.total, 14);
  assert.equal(result.items.length, 12);
  assert.equal(result.summary.rental.total, "140.00");
  assert.equal(result.summary.rental.confirmed, "10.00");
  assert.equal(result.items[0].id, "1");
  assert.equal(result.items[0].canRegister, true);
  assert.deepEqual(where.AND[0].orderId, { in: ["o"] });
  assert.deepEqual(where.AND[1], { orderId: { in: ["o"] } });
  assert.equal(where.AND[0].currency, "HKD");
  assert.ok(where.AND.some((x: any) => x.status?.not === "VOID"));
  const filtered = await listOrderBills(db, access, actor, { pending: "true" });
  assert.equal(filtered.total, 1);
  assert.equal(filtered.summary.rental.total, "10.00");
  assert.equal(filtered.items[0].remaining, "10.00");
  assert.equal(filtered.items[0].available, "5.00");
});
