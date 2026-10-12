import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { ExpensesService } from "../src/modules/expenses/expenses.service";

const actor: any = { id: "finance", name: "财务", role: "FINANCE" };
for (const feeType of ["COMMISSION", "DEPOSIT_REFUND", "RENT_REFUND"]) {
  test(`automatic ${feeType} expenses cannot be edited or removed without their original link`, async () => {
    const row = {
      id: "legacy",
      revision: 1,
      feeType,
      status: "UNPAID",
      amount: "80",
      paidAmount: "0",
      commissionId: null,
    };
    let writes = 0;
    const tx = {
      $queryRawUnsafe: async () => [],
      expense: {
        update: async () => {
          writes++;
          throw new Error("unexpected write");
        },
      },
    };
    const service = new ExpensesService(
      { $transaction: async (fn: any) => fn(tx) } as any,
      {
        allow: () => {},
        get: async () => row,
      } as any,
    );
    await assert.rejects(
      service.edit(actor, row.id, { revision: 1, amount: "40" }),
      /不能直接修改/,
    );
    await assert.rejects(service.remove(actor, row.id, "删除测试"), /不能删除/);
    assert.equal(writes, 0);
  });
}
