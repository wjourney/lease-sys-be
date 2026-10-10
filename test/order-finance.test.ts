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
test("omitting commission allows editing orders without a commission agreement", async () => {
  const f = editableFixture();
  f.tables.commission.length = 0;
  await f.lifecycle.editOrder(admin, f.order.id, {
    revision: 1,
    remark: "稍后补充佣金",
  });
  assert.equal(f.tables.order[0].remark, "稍后补充佣金");
  assert.equal(f.tables.commission.length, 0);
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
const operations: any = {
  ...admin,
  id: randomUUID(),
  name: "Operations",
  role: "OPERATIONS",
};
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
        if (op === "gt") return got > v;
        if (op === "gte") return got >= v;
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
    user: [],
    project: [],
    salesCompany: [],
    fundAccount: [],
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
      findUniqueOrThrow: async ({ where }: any) => {
        const row = tables[name].find((r) => matches(r, where));
        assert.ok(row);
        return { ...row };
      },
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
          currency: "HKD",
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
    projects: "project",
    "sales-companies": "salesCompany",
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
    status: "ACTIVE",
    occupancyState: "LOCKED",
    startsOn: new Date("2026-10-01"),
    endsOn: new Date("2027-09-30"),
    salesCompanyId: randomUUID(),
    salesUserId: randomUUID(),
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

test("initial paid declaration directly confirms receipts and activates the order", async () => {
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
    rows.every((r) => r.status === "CONFIRMED" && r.orderId === f.order.id),
  );
  assert.equal(rows[1].recurrenceRule.voucherIncomeId, rows[0].id);
  assert.equal(f.tables.order[0].occupancyState, "LOCKED");
  assert.equal(
    (await f.balances.totals(f.db, rows[0].parentId)).confirmed.toString(),
    "100",
  );
  assert.equal(f.tables.order[0].status, "ACTIVE");
  assert.equal(f.tables.invoice.length, 2);
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
          paymentState: "PAID",
          rentReceived: "100",
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
  const first = await f.receipts.batch(operations, f.order.id, body);
  const retry = await f.receipts.batch(operations, f.order.id, body);
  assert.equal(first.id, retry.id);
  assert.equal(f.tables.income.length, 4);
  await assert.rejects(
    f.receipts.batch(operations, f.order.id, {
      ...body,
      allocations: [body.allocations[0]],
    }),
  );
});
test("new receipts must settle the full remaining balance, including historical partial bills", async () => {
  const f = fixture();
  const bill = f.tables.income[0];
  await assert.rejects(f.receipts.receipt(operations, bill.id, { ...f.payment, amount: "60" }), /不支持部分付款/);
  assert.equal(f.tables.income.length, 2);
  assert.equal(f.tables.invoice.length, 0);
  const legacy = await legacyPending(f, bill, "60");
  await f.receipts.confirm(admin, legacy.id, true);
  await assert.rejects(f.receipts.receipt(operations, bill.id, { ...f.payment, sourceKey: randomUUID(), amount: "20" }), /不支持部分付款/);
  const body = { ...f.payment, sourceKey: randomUUID(), amount: "40" };
  const receipt = await f.receipts.receipt(operations, bill.id, body);
  const retry = await f.receipts.receipt(operations, bill.id, body);
  assert.equal(receipt.id, retry.id);
  assert.equal((await f.balances.totals(f.db, bill.id)).remaining.toString(), "0");
  assert.equal(f.tables.income[0].status, "PAID");
  assert.equal(f.tables.invoice.length, 2);
});
test("pending historic receipts must be resolved before a new full payment", async () => {
  const f = fixture();
  const bill = f.tables.income[0];
  const legacy = await legacyPending(f, bill, "50");
  await assert.rejects(f.receipts.receipt(operations, bill.id, { ...f.payment, sourceKey: randomUUID(), amount: "50" }), /待处理/);
  await f.receipts.confirm(admin, legacy.id, true);
  await f.receipts.receipt(operations, bill.id, { ...f.payment, sourceKey: randomUUID(), amount: "50" });
  assert.equal((await f.balances.totals(f.db, bill.id)).remaining.toString(), "0");
});
test("a partial allocation rolls back the entire order receipt group", async () => {
  const f = fixture();
  const body = f.batch();
  body.allocations[1].amount = "100";
  await assert.rejects(f.receipts.batch(operations, f.order.id, body), /不支持部分付款/);
  assert.equal(f.tables.income.length, 2);
  assert.equal(f.tables.invoice.length, 0);
});
for (const [rentReceived, depositReceived, paymentState] of [
  ["50", "200", "PAID"], ["100", "0", "PAID"], ["100", "100", undefined], ["100", "200", "PARTIAL"],
]) test(`initial payment rejects incomplete or partial declaration ${rentReceived}/${depositReceived}/${paymentState}`, async () => {
  const f = fixture();
  await assert.rejects(f.db.$transaction((tx: any) => f.receipts.initial(tx, operations, {
    ...f.order, initialPayment: { ...f.payment, paid: true, rentReceived, depositReceived, paymentState },
  })), /首期款项/);
  assert.equal(f.tables.income.length, 2);
  assert.equal(f.tables.invoice.length, 0);
});
test("full receipts preserve an active order; retry never duplicates invoice", async () => {
  const f = fixture();
  await f.receipts.receipt(operations, f.tables.income[0].id, {
    ...f.payment,
    amount: "100",
  });
  assert.equal(f.tables.order[0].status, "ACTIVE");
  const payment = { ...f.payment, sourceKey: randomUUID(), amount: "200" };
  await f.receipts.receipt(operations, f.tables.income[1].id, payment);
  await f.receipts.receipt(operations, f.tables.income[1].id, payment);
  assert.equal(f.tables.order[0].status, "ACTIVE");
  assert.equal(f.tables.invoice.length, 2);
});
async function legacyPending(
  f: ReturnType<typeof fixture>,
  bill: any,
  amount: string,
) {
  return f.db.income.create({
    data: {
      ...f.payment,
      receivedOn: new Date(f.payment.receivedOn),
      recordType: "RECEIPT",
      parentId: bill.id,
      orderId: f.order.id,
      status: "PENDING",
      amount,
      createdBy: operations.id,
    },
  });
}
test("withdrawal requires creator or finance, then releases pending reservation", async () => {
  const f = fixture();
  const r = await legacyPending(f, f.tables.income[0], "50");
  await assert.rejects(
    f.receipts.undo({ ...operations, id: randomUUID() }, r.id, {
      reason: "withdraw",
    }),
  );
  await f.receipts.undo(operations, r.id, { reason: "填错金额" });
  assert.equal(f.tables.income.find((x) => x.id === r.id).status, "WITHDRAWN");
  assert.equal(
    (await f.balances.totals(f.db, r.parentId)).available.toString(),
    "100",
  );
});
test("reversal preserves receipt and voids invoice; does not release occupied unit", async () => {
  const f = fixture();
  const result = await f.receipts.batch(operations, f.order.id, f.batch());
  for (const r of result.receipts) await f.receipts.confirm(admin, r.id, true);
  f.tables.order[0].occupancyState = "OCCUPIED";
  await assert.rejects(
    f.receipts.undo(operations, result.id, { reason: "错账" }, true),
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
  assert.equal(f.tables.order[0].status, "ACTIVE");
});
test("settlement or downstream payment blocks reversal", async () => {
  const f = fixture();
  const r = await f.receipts.receipt(operations, f.tables.income[0].id, {
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
  (f.order as any).firstPaymentRegisteredAt = new Date();
  const result = {
    receipts: await Promise.all(
      f.tables.income.slice(0, 2).map((b) => legacyPending(f, b, b.amount)),
    ),
  };
  for (const r of result.receipts)
    await f.receipts.confirm(admin, r.id, false, "重录");
  const details = new OrderDetailService(f.db, f.access, {} as any);
  const related = await details.related(admin, f.tables.order[0]);
  assert.equal(related.actions.editLease, true);
  assert.equal(related.actions.close, false);
  assert.equal(related.actions.moveIn, false);
  assert.equal(related.actions.renew, true);
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
for (const status of ["PENDING", "ACTIVE"]) test(`unpaid ${status} order expires without waiting for receipts`, async () => {
  const f = fixture();
  Object.assign(f.tables.order[0], { status, endsOn: new Date("2026-10-02"), nextBillOn: null });
  const jobs = new JobsService(f.db, f.access, {} as any);
  await jobs.generateDue(admin, new Date("2026-10-05"));
  assert.equal(f.tables.order[0].status, "COMPLETED");
});
for (const status of ["PENDING", "ACTIVE"]) test(`partial payment does not block ${status} order termination`, async () => {
  const f = fixture();
  f.tables.order[0].status = status;
  const bill = f.tables.income[0];
  const legacy = await legacyPending(f, bill, "60");
  await f.receipts.confirm(admin, legacy.id, true);
  assert.equal(f.tables.order[0].status, status);
  await assert.rejects(f.lifecycle.close(admin, f.order.id), /已有收款/);
  const ended = await f.lifecycle.terminate(admin, f.order.id, { date: "2026-10-08", reason: "租客提前退租" });
  assert.equal(ended.status, "COMPLETED");
  assert.equal((await f.balances.totals(f.db, bill.id)).confirmed.toString(), "60");
});

test("new orders require a project and unit without creating financial artifacts", async () => {
  const f = fixture();
  f.tables.order.length = 0;
  f.tables.income.length = 0;
  await assert.rejects(
    f.lifecycle.createOrder(admin, { tenantName: "海湾有限公司" }),
    /请选择项目和单位/,
  );
  assert.equal(f.tables.order.length, 0);
  assert.equal(f.tables.income.length, 0);
  assert.equal(f.tables.commission.length, 0);
  assert.equal(f.tables.invoice.length, 0);
});
test("completing a legacy draft generates monthly bills exactly once", async () => {
  const f = fixture();
  const draft = {
    ...f.order,
    status: "DRAFT",
    occupancyState: "RELEASED",
    unitId: null,
    projectId: null,
    salesUserId: null,
    salesCompanyId: null,
    monthlyRent: null,
    depositAmount: null,
    tenantName: "海湾有限公司",
    startsOn: new Date("2026-10-07"),
    endsOn: null,
  };
  f.tables.order.length = 0;
  f.tables.order.push(draft);
  f.tables.income.length = 0;
  const unit = f.tables.unit[0];
  Object.assign(unit, {
    enabled: true,
    projectId: f.order.projectId,
    referenceRent: "300",
    minLeaseMonths: 1,
  });
  f.tables.project.push({
    id: f.order.projectId,
    status: "ACTIVE",
    name: "海湾",
  });
  const order = await f.lifecycle.editOrder(admin, draft.id, {
    revision: draft.revision,
    tenantName: draft.tenantName,
    unitId: unit.id,
  });
  assert.equal(order.status, "ACTIVE");
  assert.equal(String(order.monthlyRent), "300");
  assert.equal(String(order.depositAmount), "300.00");
  assert.equal(order.endsOn.toISOString().slice(0, 10), "2027-10-06");
  assert.equal(f.tables.income.filter((b) => b.feeType === "RENT").length, 12);
  assert.equal(
    f.tables.income.filter((b) => b.feeType === "DEPOSIT").length,
    1,
  );
  assert.equal(f.tables.commission.length, 0);
  await assert.rejects(
    f.lifecycle.editOrder(admin, draft.id, {
      revision: draft.revision,
      tenantName: draft.tenantName,
      unitId: unit.id,
    }),
  );
  assert.equal(f.tables.income.length, 13);
});
test("batch receipt isolates failures and retry is idempotent per bill", async () => {
  const f = fixture();
  const entries = f.tables.income.map((bill, i) => ({
    ...f.payment,
    sourceKey: randomUUID(),
    billId: bill.id,
    amount: i ? "201" : "100",
  }));
  const result = await f.receipts.batchBills(admin, { entries });
  assert.deepEqual(
    result.results.map((r) => r.ok),
    [true, false],
  );
  assert.equal(f.tables.invoice.length, 1);
  entries[1].amount = "200";
  const retry = await f.receipts.batchBills(admin, { entries });
  assert.deepEqual(
    retry.results.map((r) => r.ok),
    [true, true],
  );
  assert.equal(f.tables.invoice.length, 2);
  assert.equal(f.tables.order[0].status, "ACTIVE");
  await assert.rejects(
    f.receipts.batchBills({ ...admin, role: "SALES" }, { entries }),
  );
});

test("optional commission omissions retain an existing schedule", async () => {
  const f = editableFixture();
  const before = structuredClone(f.tables.commission);
  await f.lifecycle.editOrder(admin, f.order.id, {
    revision: 1,
    commission: { mode: "ONE_TIME" },
    remark: "补充备注",
  });
  assert.deepEqual(f.tables.commission, before);
});


test("editing rent accepts a commission draft serialized to JSON ISO dates", async () => {
  const f = editableFixture();
  f.order.commissionDraft = JSON.parse(JSON.stringify({
    mode: "ONE_TIME", amount: "50", dueOn: new Date("2026-10-10"),
  }));
  const before = structuredClone(f.tables.commission);
  await f.lifecycle.editOrder(admin, f.order.id, { revision: 1, monthlyRent: "120" });
  assert.deepEqual(f.tables.commission, before);
  assert.equal(String(f.tables.order[0].monthlyRent), "120");
});


test("new order normalizes commission to monthly installments with a per-month amount", async () => {
  const f = fixture();
  f.tables.order.length = 0;
  f.tables.income.length = 0;
  Object.assign(f.tables.unit[0], { enabled: true, projectId: f.order.projectId, referenceRent: "300", minLeaseMonths: 1 });
  f.tables.project.push({ id: f.order.projectId, name: "海湾", status: "ACTIVE" });
  f.tables.salesCompany.push({ id: f.order.salesCompanyId, status: "ACTIVE" });
  f.tables.user.push({ id: f.order.salesUserId, role: "SALES", status: "ACTIVE", salesCompanyId: f.order.salesCompanyId });
  const created = await f.lifecycle.createOrder(admin, {
    tenantName: "月结公司", projectId: f.order.projectId, unitId: f.order.unitId, salesUserId: f.order.salesUserId,
    startsOn: "2026-10-07", endsOn: "2027-10-06",
    commission: { mode: "ONE_TIME", amount: "50", dueOn: "2026-10-10" },
  });
  const rows = f.tables.commission.filter(c => c.orderId === created.id);
  assert.equal(rows.length, 12);
  assert(rows.every(c => c.mode === "RECURRING_MONTHLY" && Number(c.amount) === 50));
  assert.equal(rows[11].dueOn.toISOString().slice(0, 10), "2027-09-10");
  assert.equal(created.commissionDraft.mode, "RECURRING_MONTHLY");
});

test("cancelling a partially paid lease before its start issues a rent refund without erasing the receipt", async () => {
  const f = fixture();
  const bill = f.tables.income[0];
  Object.assign(bill, { periodStart: new Date("2026-10-01"), periodEnd: new Date("2026-10-31") });
  const legacy = await legacyPending(f, bill, "60");
  await f.receipts.confirm(admin, legacy.id, true);
  const ended = await f.lifecycle.terminate(admin, f.order.id, { date: "2026-09-28", reason: "起租前取消" });
  assert.equal(ended.status, "COMPLETED");
  assert.equal(f.tables.expense[0].feeType, "RENT_REFUND");
  assert.equal(f.tables.expense[0].amount.toString(), "60");
  assert.equal((await f.balances.totals(f.db, bill.id)).confirmed.toString(), "60");
});

test("renewal defaults to one year after the old expiry and preserves paid history", async () => {
  const f = editableFixture();
  f.order.billingVersion = 2;
  f.order.nextBillOn = null;
  const billing = new RentBillingService(f.db, f.access);
  await billing.fullTerm(f.db, f.order, admin);
  const legacy = await legacyPending(f, f.tables.income[0], "60");
  await f.receipts.confirm(admin, legacy.id, true);
  const before = JSON.parse(JSON.stringify(f.tables));
  const revision = f.tables.order[0].revision;
  const saved = await f.lifecycle.renew(admin, f.order.id, { revision });
  assert.equal(saved.id, f.order.id);
  assert.equal(saved.endsOn.toISOString().slice(0, 10), "2028-09-30");
  assert.equal(saved.nextBillOn, null);
  const oldIds = new Set(before.income.map((r: any) => r.id));
  assert.deepEqual(JSON.parse(JSON.stringify(f.tables.income.filter(r => oldIds.has(r.id)))), before.income);
  const added = f.tables.income.filter(r => !oldIds.has(r.id));
  assert.equal(added.length, 12);
  assert.equal(added[0].periodStart.toISOString().slice(0, 10), "2027-10-01");
  assert.equal(added[11].periodEnd.toISOString().slice(0, 10), "2028-09-30");
  for (const name of ["commission", "expense", "invoice"]) assert.deepEqual(JSON.parse(JSON.stringify(f.tables[name])), before[name]);
  assert.equal(saved.depositAmount, "200");
  assert.match(saved.operationLogs.at(-1).reason, /续约/);
  await assert.rejects(f.lifecycle.renew(admin, f.order.id, { revision }), /订单已更新/);
  assert.equal(f.tables.income.length, before.income.length + 12);
});

test("custom renewal after a partial month appends continuous periods without repricing the old final bill", async () => {
  const f = editableFixture();
  Object.assign(f.order, { billingVersion: 2, endsOn: new Date("2027-02-15"), nextBillOn: null });
  await new RentBillingService(f.db, f.access).fullTerm(f.db, f.order, admin);
  const original = JSON.parse(JSON.stringify(f.tables.income));
  await f.lifecycle.renew(admin, f.order.id, { revision: 1, endsOn: "2027-03-31" });
  assert.deepEqual(JSON.parse(JSON.stringify(f.tables.income.slice(0, original.length))), original);
  const added = f.tables.income.slice(original.length);
  assert.equal(added.length, 2);
  assert.equal(added[0].periodStart.toISOString().slice(0, 10), "2027-02-16");
  assert.equal(added[0].periodEnd.toISOString().slice(0, 10), "2027-02-28");
  assert.equal(added[1].periodStart.toISOString().slice(0, 10), "2027-03-01");
  assert.equal(added[1].periodEnd.toISOString().slice(0, 10), "2027-03-31");
});

test("renewal appends monthly commission while preserving already paid commission", async () => {
  const f = editableFixture();
  f.order.billingVersion = 2;
  f.tables.commission.length = 0;
  await f.lifecycle.editOrder(admin, f.order.id, { revision: 1, commission: { mode: "RECURRING_MONTHLY", amount: "50", dueOn: "2026-10-10" } });
  f.tables.commission[0].status = "PAID";
  f.tables.expense.push({ commissionId: f.tables.commission[0].id, status: "PAID", paidAmount: "50" });
  const before = JSON.parse(JSON.stringify(f.tables.commission));
  await f.lifecycle.renew(admin, f.order.id, { revision: f.tables.order[0].revision });
  assert.deepEqual(JSON.parse(JSON.stringify(f.tables.commission.slice(0, 12))), before);
  assert.equal(f.tables.commission.length, 24);
  assert.equal(f.tables.commission[12].periodStart.toISOString().slice(0, 10), "2027-10-01");
  assert.equal(f.tables.commission[12].dueOn.toISOString().slice(0, 10), "2027-10-10");
});

for (const endsOn of ["2027-09-30", "2027-09-29", "2076-10-01"]) test(`renewal rejects invalid or excessive expiry ${endsOn} without writes`, async () => {
  const f = editableFixture();
  const before = JSON.parse(JSON.stringify(f.tables));
  await assert.rejects(f.lifecycle.renew(admin, f.order.id, { revision: 1, endsOn }));
  assert.deepEqual(JSON.parse(JSON.stringify(f.tables)), before);
});

test("renewal rejects conflicting future leases, ended orders and unauthorized actors", async () => {
  const f = editableFixture();
  f.tables.order.push({ ...f.order, id: randomUUID(), startsOn: new Date("2027-10-01"), endsOn: new Date("2027-12-31") });
  await assert.rejects(f.lifecycle.renew(admin, f.order.id, { revision: 1 }), /已被占用/);
  assert.equal(f.tables.income.length, 2);
  f.tables.order.length = 1;
  f.tables.order[0].status = "COMPLETED";
  await assert.rejects(f.lifecycle.renew(admin, f.order.id, { revision: 1 }), /仅进行中/);
  await assert.rejects(f.lifecycle.renew({ ...admin, role: "SALES" }, f.order.id, { revision: 1 }));
});

test("expiry occurs at Hong Kong midnight, releases occupancy, and needs no handover", async () => {
  const f = fixture();
  Object.assign(f.tables.order[0], { endsOn: new Date("2026-10-02"), nextBillOn: null });
  const jobs = new JobsService(f.db, f.access, {} as any);
  await jobs.generateDue(admin, new Date("2026-10-02T15:59:59Z"));
  assert.equal(f.tables.order[0].status, "ACTIVE");
  await jobs.generateDue(admin, new Date("2026-10-02T16:00:00Z"));
  assert.equal(f.tables.order[0].status, "COMPLETED");
  assert.equal(f.tables.order[0].occupancyState, "RELEASED");
  const logs = f.tables.order[0].operationLogs.length;
  await jobs.generateDue(admin, new Date("2026-10-03T16:00:00Z"));
  assert.equal(f.tables.order[0].operationLogs.length, logs);
});

test("expiry job rechecks locked end date after a concurrent renewal", async () => {
  const f = fixture();
  Object.assign(f.tables.order[0], { endsOn: new Date("2026-10-02"), nextBillOn: null });
  const findMany = f.db.order.findMany;
  let raced = false;
  f.db.order.findMany = async (query: any) => {
    const result = await findMany(query);
    if (!raced && query.where.endsOn) {
      raced = true;
      f.tables.order[0].endsOn = new Date("2027-10-02");
    }
    return result;
  };
  await new JobsService(f.db, f.access, {} as any).generateDue(admin, new Date("2026-10-05"));
  assert.equal(f.tables.order[0].status, "ACTIVE");
  assert.notEqual(f.tables.order[0].occupancyState, "RELEASED");
});

test("legacy ended units are released without a separate handover step", async () => {
  const f = fixture();
  Object.assign(f.tables.order[0], { status: "COMPLETED", nextBillOn: null });
  await new JobsService(f.db, f.access, {} as any).generateDue(admin, new Date("2026-10-05"));
  assert.equal(f.tables.order[0].occupancyState, "RELEASED");
  assert.match(f.tables.order[0].operationLogs.at(-1).reason, /释放单位/);
});

test("early termination immediately releases the unit without affecting receipt history", async () => {
  const f = fixture();
  const saved = await f.lifecycle.terminate(admin, f.order.id, { date: "2026-10-08", revision: 1 });
  assert.equal(saved.status, "COMPLETED");
  assert.equal(saved.occupancyState, "RELEASED");
  assert.equal(saved.nextBillOn, null);
  assert.equal(saved.actualTerminationOn.toISOString().slice(0, 10), "2026-10-08");
  const tomorrow = new Date(); tomorrow.setUTCDate(tomorrow.getUTCDate() + 2);
  const next = fixture();
  await assert.rejects(next.lifecycle.terminate(admin, next.order.id, { date: tomorrow.toISOString().slice(0, 10) }), /不能晚于今天/);
});
