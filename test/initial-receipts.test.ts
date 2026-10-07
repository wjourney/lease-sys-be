import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ReceiptsService } from "../src/modules/incomes/receipts.service";
import { number } from "../src/common/utils/value";

function fixture(rentReceived = "15000.00") {
  const actor: any = { id: "operator", name: "运营", role: "OPERATIONS" };
  const order = {
    id: "order",
    status: "PENDING",
    startsOn: new Date("2026-10-02"),
    tenantName: "租客",
    firstPaymentRegisteredAt: new Date(),
    initialPayment: {
      paid: true,
      paymentState: "PAID",
      rentReceived,
      depositReceived: "15000.00",
      fundAccountId: "account",
      paymentMethod: "BANK",
      receivedOn: "2026-10-02",
    },
  };
  const bills = [
    { id: "rent", feeType: "RENT", amount: "15016.13" },
    { id: "deposit", feeType: "DEPOSIT", amount: "15000.00" },
  ].map((bill) => ({
    ...bill,
    orderId: order.id,
    recordType: "RECEIVABLE",
    status: "OPEN",
    currency: "HKD",
    adjustmentAmount: "0",
  }));
  const receipts: any[] = [];
  const tx = {
    income: {
      findMany: async () => bills,
      findUnique: async () => null,
      create: async ({ data }: any) => {
        const receipt = { ...data, id: `receipt-${receipts.length}` };
        receipts.push(receipt);
        return receipt;
      },
    },
    order: { findUnique: async () => order },
  };
  const service = new ReceiptsService(
    {} as any,
    {} as any,
    {
      totals: async (_: any, id: string) => ({
        available: number(bills.find((bill) => bill.id === id)!.amount),
      }),
    } as any,
    { checkAccount: async () => undefined } as any,
  );
  return { actor, order, receipts, tx, service };
}

test("paid declaration allows actual initial receipts below the calculated bill", async () => {
  const f = fixture();
  await f.service.initial(f.tx, f.actor, f.order);
  assert.deepEqual(
    f.receipts.map((r) => [r.parentId, r.amount, r.status]),
    [
      ["rent", "15000.00", "PENDING"],
      ["deposit", "15000.00", "PENDING"],
    ],
  );
  assert.equal(f.order.status, "PENDING");
});

test("exact initial payment still registers normally", async () => {
  const f = fixture("15016.13");
  await f.service.initial(f.tx, f.actor, f.order);
  assert.equal(f.receipts.length, 2);
  assert.equal(f.receipts[0].amount, "15016.13");
});

test("initial registration still rejects an amount above the available balance", async () => {
  const f = fixture("15017.00");
  await assert.rejects(
    f.service.initial(f.tx, f.actor, f.order),
    /金额超过可登记余额/,
  );
  assert.equal(f.receipts.length, 0);
});
