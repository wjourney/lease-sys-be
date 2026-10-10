import "reflect-metadata";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { number, plain } from "../src/common/utils/value";
import { CommissionBalanceService } from "../src/modules/commissions/commission-balance.service";
import { CommissionPaymentsService } from "../src/modules/commissions/commission-payments.service";
import { PaymentsService } from "../src/modules/expenses/payments.service";
import { movements, totals } from "../src/modules/finance/ledger";

const actor = {
  id: randomUUID(),
  role: "FINANCE",
  name: "财务",
  salesCompanyId: null,
  authVersion: 1,
};
const payment = {
  sourceKey: randomUUID(),
  paidOn: "2026-10-10",
  fundAccountId: randomUUID(),
  paymentMethod: "BANK",
};
function fixture(override: any = {}) {
  let row: any = {
    id: randomUUID(),
    amount: "100.01",
    paidAmount: "0",
    status: "UNPAID",
    currency: "HKD",
    feeType: "OTHER",
    paymentRecords: [],
    revision: 1,
    operationLogs: [],
    ...override,
  };
  const tx: any = {
    $queryRawUnsafe: async () => [],
    expense: {
      updateMany: async ({ data, where }: any) => {
        assert.equal(where.revision, row.revision);
        row = { ...row, ...plain(data), revision: row.revision + 1 };
        return { count: 1 };
      },
      findUnique: async () => row,
    },
  };
  const db: any = { $transaction: async (run: any) => run(tx) };
  const service = new PaymentsService(
    db,
    { get: async () => plain(row) } as any,
    { checkAccount: async () => {} } as any,
    { commissionBalance: async () => {} } as any,
  );
  return { service, row: () => row };
}

test("all expense types reject partial and excessive payments without changing balances", async () => {
  for (const feeType of [
    "OTHER",
    "COMMISSION",
    "DEPOSIT_REFUND",
    "RENT_REFUND",
  ]) {
    const f = fixture({ feeType });
    for (const amount of ["40", "100.02", "0"]) {
      await assert.rejects(
        f.service.pay(actor, f.row().id, { ...payment, amount }),
      );
      assert.equal(f.row().paidAmount, "0");
      assert.equal(f.row().paymentRecords.length, 0);
      assert.equal(f.row().revision, 1);
    }
    await f.service.pay(actor, f.row().id, { ...payment, amount: "100.01" });
    assert.equal(String(f.row().paidAmount), "100.01");
    assert.equal(f.row().status, "PAID");
    assert.equal(f.row().paymentRecords.length, 1);
    await f.service.pay(actor, f.row().id, { ...payment, amount: "100.01" });
    assert.equal(f.row().paymentRecords.length, 1);
    await assert.rejects(
      f.service.pay(actor, f.row().id, {
        ...payment,
        sourceKey: randomUUID(),
        amount: "100.01",
      }),
      /已付清/,
    );
  }
});

test("legacy partial payments can only have their full remaining balance paid, preserving old ledger movements", async () => {
  for (const hasRecords of [false, true]) {
    const previous = {
      amount: "30.01",
      paidOn: "2026-10-01",
      fundAccountId: payment.fundAccountId,
      paymentMethod: "BANK",
      sourceKey: randomUUID(),
    };
    const f = fixture({
      paidAmount: "30.01",
      feeType: "DEPOSIT_REFUND",
      paidOn: new Date(previous.paidOn),
      fundAccountId: previous.fundAccountId,
      paymentMethod: previous.paymentMethod,
      paymentRecords: hasRecords ? [previous] : [],
    });
    await assert.rejects(
      f.service.pay(actor, f.row().id, { ...payment, amount: "20" }),
      /不支持部分付款/,
    );
    if (hasRecords) {
      await f.service.pay(actor, f.row().id, { ...previous });
      assert.equal(String(f.row().paidAmount), "30.01");
    }
    await f.service.pay(actor, f.row().id, { ...payment, amount: "70" });
    assert.equal(f.row().paymentRecords.length, 2);
    assert.equal(f.row().paymentRecords[0].amount, "30.01");
    assert.equal(f.row().paymentRecords[1].amount, "70.00");
    assert.equal(f.row().status, "PAID");
    assert.equal(totals(movements([], [f.row()])).outgoing, "100.01");
  }
});

test("legacy expense clients omitting amount still pay the complete balance", async () => {
  const f = fixture();
  await f.service.pay(actor, f.row().id, payment);
  assert.equal(String(f.row().paidAmount), "100.01");
  assert.equal(f.row().paymentRecords[0].amount, "100.01");
});

function commissionFixture(expenses: any[] = []) {
  const c = {
    id: randomUUID(),
    amount: "100.01",
    status: "OPEN",
    currency: "HKD",
    salesCompanyId: randomUUID(),
  };
  const tx: any = {
    $queryRawUnsafe: async () => [],
    commission: { findUnique: async () => c },
    salesCompany: { findUnique: async () => ({ name: "销售公司" }) },
    expense: {
      findMany: async () => expenses,
      findUnique: async ({ where }: any) =>
        expenses.find((e) => e.sourceKey === where.sourceKey),
      create: async ({ data }: any) => {
        expenses.push(data);
        return data;
      },
    },
  };
  const db: any = { $transaction: async (run: any) => run(tx) };
  const balances = new CommissionBalanceService(db, {} as any);
  const service = new CommissionPaymentsService(
    db,
    { get: async () => c } as any,
    { checkAccount: async () => {} } as any,
    balances,
  );
  return { c, tx, expenses, balances, service };
}

test("commission payouts must pay the complete balance including legacy remaining cents", async () => {
  const f = commissionFixture([
    { status: "PAID", amount: "30.01", paidAmount: "30.01" },
  ]);
  await assert.rejects(
    f.service.commissionPay(actor, f.c.id, { ...payment, amount: "40" }),
    /不支持部分付款/,
  );
  await f.service.commissionPay(actor, f.c.id, { ...payment, amount: "70" });
  await f.service.commissionPay(actor, f.c.id, { ...payment, amount: "70" });
  assert.equal(f.expenses.length, 2);
  assert.equal(f.expenses[1].paidAmount, "70");
  await assert.rejects(
    f.service.commissionPay(actor, f.c.id, {
      ...payment,
      sourceKey: randomUUID(),
      amount: "70",
    }),
    /超过佣金/,
  );
});

test("reserved commission expenses must be paid from expenses, rather than generating duplicate payouts", async () => {
  const f = commissionFixture([{ status: "UNPAID", amount: "40" }]);
  await assert.rejects(
    f.service.commissionPay(actor, f.c.id, { ...payment, amount: "60.01" }),
    /已有待付支出/,
  );
  assert.equal(f.expenses.length, 1);
  // Paying an existing reserved expense still runs its commission safety check.
  await f.balances.commissionBalance(f.tx, f.c.id, number(0));
});

test("retries of a previously recorded partial commission payout remain idempotent", async () => {
  const f = commissionFixture();
  f.expenses.push({
    ...payment,
    paidOn: new Date(payment.paidOn),
    commissionId: f.c.id,
    amount: "30",
    paidAmount: "30",
    status: "PAID",
  });
  await f.service.commissionPay(actor, f.c.id, { ...payment, amount: "30" });
  assert.equal(f.expenses.length, 1);
  await assert.rejects(
    f.service.commissionPay(actor, f.c.id, { ...payment, amount: "31" }),
    /编号冲突/,
  );
});
