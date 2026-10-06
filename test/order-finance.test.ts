import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ReceiptsService } from "../src/modules/incomes/receipts.service";
import { IncomeBalanceService } from "../src/modules/incomes/income-balance.service";
import { OrderLifecycleService } from "../src/modules/orders/order-lifecycle.service";
import { OrderDetailService } from "../src/modules/orders/order-detail.service";
import { orderSettlement } from "../src/modules/orders/order-settlement";
import { JobsService } from "../src/modules/jobs/jobs.service";
import { RentBillingService } from "../src/modules/incomes/rent-billing.service";

function editableFixture() {
  const f = fixture();
  Object.assign(f.order, {
    monthlyRent: "100",
    paymentIntervalMonths: 1,
    rentDueDay: 10,
    firstPeriodProration: true,
    lastPeriodProration: true,
    nextBillOn: new Date("2026-11-01"),
  });
  Object.assign(f.tables.unit[0], { minLeaseMonths: 1 });
  f.tables.commission.push({
    id: randomUUID(),
    orderId: f.order.id,
    revision: 1,
    mode: "ONE_TIME",
    status: "OPEN",
    amount: "50",
    dueOn: new Date("2026-10-10"),
    periodStart: f.order.startsOn,
    periodEnd: f.order.endsOn,
    remark: null,
    operationLogs: [],
  });
  return f;
}
const commissionInput = { mode: "ONE_TIME", amount: "60", dueOn: "2026-10-10" };
test("rent-only change preserves deposit bill and omitted commission stays unchanged", async () => {
  const f = editableFixture();
  const deposit = structuredClone(f.tables.income[1]);
  await f.lifecycle.editOrder(admin, f.order.id, {
    revision: 1,
    reason: "调整月租",
    monthlyRent: "120",
  });
  assert.deepEqual(f.tables.income[1], deposit);
  assert.equal(f.tables.income[0].status, "VOID");
  assert.equal(f.tables.income[2].feeType, "RENT");
  assert.equal(String(f.tables.income[2].amount), "120");
  assert.equal(f.tables.commission[0].revision, 1);
});
test("commission-only edit preserves rent/deposit IDs, states, revisions and next billing date", async () => {
  const f = editableFixture();
  const before = structuredClone(f.tables.income);
  await f.lifecycle.editOrder(admin, f.order.id, {
    revision: 1,
    reason: "佣金调整",
    commission: commissionInput,
    monthlyRent: "100.00",
    depositAmount: "200.00",
    startsOn: "2026-10-01",
    endsOn: "2027-09-30",
  });
  assert.deepEqual(f.tables.income, before);
  assert.equal(f.tables.commission.length, 1);
  assert.equal(f.tables.commission[0].amount, "60");
  assert.equal(
    f.tables.order[0].nextBillOn.toISOString().slice(0, 10),
    "2026-11-01",
  );
});
test("contact edit and unchanged commission do not mutate any financial record", async () => {
  const f = editableFixture();
  const before = structuredClone(f.tables.income);
  await f.lifecycle.editOrder(admin, f.order.id, {
    revision: 1,
    reason: "联系方式",
    tenantPhone: "12345",
    commission: { ...commissionInput, amount: "50.00" },
  });
  assert.deepEqual(f.tables.income, before);
  assert.equal(f.tables.commission[0].revision, 1);
});
test("deposit-only change leaves rent bill intact", async () => {
  const f = editableFixture();
  const rent = structuredClone(f.tables.income[0]);
  await f.lifecycle.editOrder(admin, f.order.id, {
    revision: 1,
    reason: "押金调整",
    depositAmount: "300",
  });
  assert.deepEqual(f.tables.income[0], rent);
  assert.equal(f.tables.income[1].status, "VOID");
  assert.equal(f.tables.income[2].amount, "300");
});
test("commission mode switch preserves void history and never revives it on switch back", async () => {
  const f = editableFixture();
  const originalId = f.tables.commission[0].id;
  await f.lifecycle.editOrder(admin, f.order.id, {
    revision: 1,
    reason: "改月结",
    commission: { ...commissionInput, mode: "RECURRING_MONTHLY" },
  });
  assert.equal(f.tables.commission[0].status, "VOID");
  assert.equal(
    f.tables.commission.filter((c) => c.status === "OPEN").length,
    12,
  );
  await f.lifecycle.editOrder(admin, f.order.id, {
    revision: 2,
    reason: "改一次性",
    commission: commissionInput,
  });
  assert.equal(
    f.tables.commission.find((c) => c.id === originalId).status,
    "VOID",
  );
  assert.equal(
    f.tables.commission.filter((c) => c.status === "OPEN").length,
    1,
  );
  assert.notEqual(
    f.tables.commission.find((c) => c.status === "OPEN").id,
    originalId,
  );
});
test("commission is mandatory for legacy edits and cannot be zero even after receipts", async () => {
  const f = editableFixture();
  f.tables.commission.length = 0;
  await assert.rejects(
    f.lifecycle.editOrder(admin, f.order.id, {
      revision: 1,
      reason: "修改备注",
      remark: "a",
    }),
  );
  f.order.status = "ACTIVE";
  await assert.rejects(
    f.lifecycle.editOrder(admin, f.order.id, {
      revision: 1,
      reason: "佣金调整",
      commission: { ...commissionInput, amount: "0" },
    }),
  );
  assert.equal(f.tables.order[0].revision, 1);
});
test("commission with a downstream payment plan rejects change and rolls back everything", async () => {
  const f = editableFixture();
  f.tables.expense.push({
    commissionId: f.tables.commission[0].id,
    status: "UNPAID",
  });
  const before = structuredClone(f.tables.income);
  await assert.rejects(
    f.lifecycle.editOrder(admin, f.order.id, {
      revision: 1,
      reason: "佣金调整",
      commission: commissionInput,
    }),
  );
  assert.deepEqual(f.tables.income, before);
  assert.equal(f.tables.commission[0].amount, "50");
});

const admin: any = {
  id: randomUUID(),
  name: "Admin",
  role: "SUPER_ADMIN",
  salesCompanyId: null,
  authVersion: 1,
};
const sales: any = { ...admin, id: randomUUID(), name: "Sales", role: "SALES" };
const accountId = randomUUID();
function matches(row: any, where: any): boolean {
  return Object.entries(where ?? {}).every(([key, value]: any) => {
    if (key === "AND") return value.every((w: any) => matches(row, w));
    if (key === "OR") return value.some((w: any) => matches(row, w));
    const got = row[key];
    if (value === null) return got == null;
    if (value instanceof Date) return got?.getTime() === value.getTime();
    if (value && typeof value === "object")
      return Object.entries(value).every(([op, v]: any) => {
        if (op === "in") return v.includes(got);
        if (op === "not") return got !== v;
        if (op === "startsWith")
          return typeof got === "string" && got.startsWith(v);
        if (op === "lt") return got < v;
        if (op === "lte") return got <= v;
        throw new Error(`Unsupported filter ${op}`);
      });
    return got === value;
  });
}
function fixture() {
  const tables: Record<string, any[]> = {
    income: [],
    order: [],
    invoice: [],
    expense: [],
    commission: [],
    unit: [],
    material: [],
  };
  const db: any = { $queryRawUnsafe: async () => [] };
  for (const name of Object.keys(tables))
    db[name] = {
      findMany: async ({ where }: any = {}) =>
        tables[name].filter((r) => matches(r, where)).map((r) => ({ ...r })),
      findUnique: async ({ where }: any) =>
        tables[name].find((r) => matches(r, where))
          ? { ...tables[name].find((r) => matches(r, where)) }
          : null,
      findFirst: async ({ where }: any) =>
        tables[name].find((r) => matches(r, where))
          ? { ...tables[name].find((r) => matches(r, where)) }
          : null,
      count: async ({ where }: any) =>
        tables[name].filter((r) => matches(r, where)).length,
      create: async ({ data }: any) => {
        const r = {
          id: randomUUID(),
          revision: 1,
          deletedAt: null,
          status: name === "invoice" ? "ACTIVE" : "OPEN",
          operationLogs: [],
          adjustmentAmount: "0",
          depositOffsetAmount: "0",
          ...data,
        };
        tables[name].push(r);
        return { ...r };
      },
      updateMany: async ({ where, data }: any) => {
        const rows = tables[name].filter((r) => matches(r, where));
        for (const r of rows) {
          const revision = r.revision;
          Object.assign(r, data);
          if (data.revision?.increment)
            r.revision = revision + data.revision.increment;
        }
        return { count: rows.length };
      },
    };
  db.$transaction = async (fn: any) => {
    const before = Object.fromEntries(
      Object.entries(tables).map(([k, rows]) => [
        k,
        rows.map((r) => ({ ...r })),
      ]),
    );
    try {
      return await fn(db);
    } catch (e) {
      for (const k of Object.keys(tables)) tables[k] = before[k];
      throw e;
    }
  };
  const map: Record<string, string> = {
    orders: "order",
    incomes: "income",
    units: "unit",
    commissions: "commission",
    materials: "material",
  };
  const access: any = {
    allow: () => {},
    scope: async () => ({}),
    output: async (_a: any, _r: any, row: any) => ({ ...row }),
    get: async (_a: any, r: string, id: string, tx = db) => {
      const found = await tx[map[r]].findUnique({ where: { id } });
      assert.ok(found, `Missing ${r}/${id}`);
      return found;
    },
  };
  const balances = new IncomeBalanceService(db, access);
  const receipts = new ReceiptsService(db, access, balances, {
    checkAccount: async (_tx: any, id: string) => {
      assert.equal(id, accountId);
    },
  } as any);
  const lifecycle = new OrderLifecycleService(
    db,
    access,
    new RentBillingService(db, access),
    receipts,
  );
  const order = {
    id: randomUUID(),
    unitId: randomUUID(),
    projectId: randomUUID(),
    revision: 1,
    status: "PENDING",
    occupancyState: "LOCKED",
    startsOn: new Date("2026-10-01"),
    endsOn: new Date("2027-09-30"),
    tenantName: "Tenant",
    currency: "HKD",
    depositAmount: "200",
    handoverStatus: "PENDING",
    depositDeductionAmount: "0",
    operationLogs: [],
  };
  tables.order.push(order);
  tables.unit.push({ id: order.unitId, revision: 1 });
  for (const [type, value] of [
    ["RENT", "100"],
    ["DEPOSIT", "200"],
  ])
    tables.income.push({
      id: randomUUID(),
      orderId: order.id,
      projectId: order.projectId,
      unitId: order.unitId,
      revision: 1,
      recordType: "RECEIVABLE",
      feeType: type,
      amount: value,
      adjustmentAmount: "0",
      depositOffsetAmount: "0",
      currency: "HKD",
      status: "OPEN",
      sourceKey:
        type === "RENT" ? `rent:${order.id}:2026-10-01` : `deposit:${order.id}`,
      operationLogs: [],
    });
  const payment = {
    receivedOn: "2026-10-01",
    fundAccountId: accountId,
    paymentMethod: "BANK",
    payerName: "Tenant",
    sourceKey: randomUUID(),
  };
  const batch = () => ({
    ...payment,
    allocations: tables.income
      .filter((r) => r.recordType === "RECEIVABLE")
      .map((r) => ({ billId: r.id, amount: r.amount })),
  });
  return {
    db,
    tables,
    access,
    balances,
    receipts,
    lifecycle,
    order,
    payment,
    batch,
  };
}

test("initial paid declaration creates pending receipts, shares proof, keeps unit locked", async () => {
  const f = fixture();
  const initialPayment = {
    paid: true,
    paymentState: "PAID",
    rentReceived: "100",
    depositReceived: "200",
    ...f.payment,
  };
  await f.db.$transaction((tx: any) =>
    f.receipts.initial(tx, admin, { ...f.order, initialPayment }),
  );
  const rows = f.tables.income.filter((r) => r.recordType === "RECEIPT");
  assert.equal(rows.length, 2);
  assert.ok(
    rows.every((r) => r.status === "PENDING" && r.orderId === f.order.id),
  );
  assert.equal(rows[1].recurrenceRule.voucherIncomeId, rows[0].id);
  assert.equal(f.tables.order[0].occupancyState, "LOCKED");
  assert.equal(
    (await f.balances.totals(f.db, rows[0].parentId)).confirmed.toString(),
    "0",
  );
});
test("initial overpayment rolls back all allocations", async () => {
  const f = fixture();
  await assert.rejects(
    f.db.$transaction((tx: any) =>
      f.receipts.initial(tx, admin, {
        ...f.order,
        initialPayment: {
          ...f.payment,
          paid: true,
          paymentState: "PARTIAL",
          rentReceived: "50",
          depositReceived: "201",
        },
      }),
    ),
  );
  assert.equal(f.tables.income.length, 2);
  assert.equal(f.tables.order[0].firstPaymentRegisteredAt, undefined);
});
test("batch retry is idempotent and rejects a changed allocation set", async () => {
  const f = fixture();
  const body = f.batch();
  const first = await f.receipts.batch(sales, f.order.id, body);
  const retry = await f.receipts.batch(sales, f.order.id, body);
  assert.equal(first.id, retry.id);
  assert.equal(f.tables.income.length, 4);
  await assert.rejects(
    f.receipts.batch(sales, f.order.id, {
      ...body,
      allocations: [body.allocations[0]],
    }),
  );
});
test("partial pending payment reserves only available balance, not confirmed money", async () => {
  const f = fixture();
  const bill = f.tables.income[0];
  const r = await f.receipts.receipt(sales, bill.id, {
    ...f.payment,
    amount: "60",
  });
  let sum = await f.balances.totals(f.db, bill.id);
  assert.equal(sum.available.toString(), "40");
  assert.equal(sum.remaining.toString(), "100");
  await f.receipts.confirm(admin, r.id, false, "金额错误");
  sum = await f.balances.totals(f.db, bill.id);
  assert.equal(sum.available.toString(), "100");
  assert.equal(f.tables.order[0].occupancyState, "LOCKED");
});
test("only full confirmed first payment activates order; confirmation retry creates no duplicate invoice", async () => {
  const f = fixture();
  const result = await f.receipts.batch(sales, f.order.id, f.batch());
  await f.receipts.confirm(admin, result.receipts[0].id, true);
  assert.equal(f.tables.order[0].status, "PENDING");
  await f.receipts.confirm(admin, result.receipts[1].id, true);
  await f.receipts.confirm(admin, result.receipts[1].id, true);
  assert.equal(f.tables.order[0].status, "ACTIVE");
  assert.equal(f.tables.order[0].occupancyState, "LOCKED");
  assert.equal(f.tables.invoice.length, 2);
});
test("withdrawal requires creator or finance, then releases pending reservation", async () => {
  const f = fixture();
  const r = await f.receipts.receipt(sales, f.tables.income[0].id, {
    ...f.payment,
    amount: "50",
  });
  await assert.rejects(
    f.receipts.undo({ ...sales, id: randomUUID() }, r.id, {
      reason: "withdraw",
    }),
  );
  await f.receipts.undo(sales, r.id, { reason: "填错金额" });
  assert.equal(f.tables.income.find((x) => x.id === r.id).status, "WITHDRAWN");
  assert.equal(
    (await f.balances.totals(f.db, r.parentId)).available.toString(),
    "100",
  );
});
test("reversal preserves receipt and voids invoice; does not release occupied unit", async () => {
  const f = fixture();
  const result = await f.receipts.batch(sales, f.order.id, f.batch());
  for (const r of result.receipts) await f.receipts.confirm(admin, r.id, true);
  f.tables.order[0].occupancyState = "OCCUPIED";
  await assert.rejects(
    f.receipts.undo(sales, result.id, { reason: "错账" }, true),
  );
  await f.receipts.undo(admin, result.id, { reason: "错账" }, true);
  assert.equal(
    f.tables.income.find((r) => r.id === result.id).status,
    "REVERSED",
  );
  assert.equal(
    f.tables.invoice.find((r) => r.incomeId === result.id).status,
    "VOID",
  );
  assert.equal(f.tables.order[0].occupancyState, "OCCUPIED");
  assert.equal(f.tables.order[0].status, "PENDING");
});
test("settlement or downstream payment blocks reversal", async () => {
  const f = fixture();
  const r = await f.receipts.receipt(sales, f.tables.income[0].id, {
    ...f.payment,
    amount: "100",
  });
  await f.receipts.confirm(admin, r.id, true);
  f.tables.expense.push({
    id: randomUUID(),
    orderId: f.order.id,
    status: "UNPAID",
  });
  await assert.rejects(f.receipts.undo(admin, r.id, { reason: "wrong" }, true));
  assert.equal(f.tables.income.find((x) => x.id === r.id).status, "CONFIRMED");
});
test("all rejected receipts unlock lease editing and cancellation despite historical registration", async () => {
  const f = fixture();
  const result = await f.receipts.batch(sales, f.order.id, f.batch());
  for (const r of result.receipts)
    await f.receipts.confirm(admin, r.id, false, "重录");
  const details = new OrderDetailService(f.db, f.access, {} as any);
  const related = await details.related(admin, f.tables.order[0]);
  assert.equal(related.actions.editLease, true);
  assert.equal(related.actions.close, true);
  f.tables.commission.push({
    id: randomUUID(),
    orderId: f.order.id,
    revision: 1,
    status: "OPEN",
    operationLogs: [],
  });
  await f.lifecycle.close(admin, f.order.id);
  assert.equal(f.tables.order[0].status, "CLOSED");
  assert.equal(f.tables.order[0].occupancyState, "RELEASED");
  assert.equal(f.tables.commission[0].status, "VOID");
});
test("lease ended and handed over is not complete until refunds and commission are cleared", () => {
  const o = {
    status: "COMPLETED",
    handoverStatus: "DONE",
    depositSettledAt: new Date(),
  };
  const bills = [
    {
      id: "b",
      amount: "100",
      adjustmentAmount: "0",
      depositOffsetAmount: "30",
      status: "PAID",
    },
  ];
  const receipts = [{ parentId: "b", status: "CONFIRMED", amount: "70" }];
  const expenses = [
    { id: "e", status: "UNPAID", amount: "50", paidAmount: "20" },
  ];
  const commissions = [{ id: "c", amount: "20", status: "OPEN" }];
  assert.equal(
    orderSettlement(o, bills, receipts, expenses, commissions).complete,
    false,
  );
  expenses[0].paidAmount = "50";
  commissions[0].status = "VOID";
  assert.equal(
    orderSettlement(o, bills, receipts, expenses, commissions).complete,
    true,
  );
  receipts.push({ parentId: "b", status: "PENDING", amount: "1" });
  assert.equal(
    orderSettlement(o, bills, receipts, expenses, commissions).complete,
    false,
  );
});
test("unactivated order never generates subsequent rent bills", async () => {
  const f = fixture();
  f.tables.order[0].nextBillOn = new Date("2026-11-01");
  const jobs = new JobsService(f.db, f.access, {
    bill: () => {
      throw new Error("must not generate");
    },
  } as any);
  assert.equal(
    (await jobs.generateDue(admin, new Date("2026-12-01"))).generated,
    0,
  );
});
