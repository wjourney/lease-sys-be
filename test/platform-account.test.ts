import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { FundAccountsService } from "../src/modules/fund-accounts/fund-accounts.service";
import { defaultInitialAccount } from "../src/modules/fund-accounts/default-platform-account";

const actor: any = { id: "admin", name: "管理员", role: "ADMIN" };
const account = {
  id: "account",
  name: "平台收款",
  bankName: "示例银行",
  accountIdentifier: "000123",
  enabled: true,
  currency: "HKD",
};
const body = {
  name: account.name,
  bankName: account.bankName,
  accountIdentifier: account.accountIdentifier,
};

test("only the first platform account can be created, including when it is later disabled", async () => {
  let saved: any;
  const tx = {
    fundAccount: {
      findFirst: async () => saved,
      create: async ({ data }: any) => (saved = { ...data, id: "account" }),
    },
  };
  const db: any = {
    $transaction: async (run: any, options: any) => {
      assert.equal(options.isolationLevel, "Serializable");
      return run(tx);
    },
  };
  const service = new FundAccountsService(db, { allow: () => {} } as any);
  await service.create(actor, body);
  assert.equal(saved.operationLogs[0].action, "CREATE");
  await assert.rejects(service.create(actor, body), /只允许创建一个/);
  saved.enabled = false;
  await assert.rejects(service.create(actor, body), /只允许创建一个/);
});

test("platform accounts cannot be deleted even when unused", async () => {
  const service = new FundAccountsService(
    {} as any,
    { allow: () => {} } as any,
  );
  await assert.rejects(service.remove(actor, "unused", "删除"), /不能删除/);
});

test("concurrent creation conflicts return an actionable message", async () => {
  const db: any = {
    $transaction: async () => {
      throw { code: "P2034" };
    },
  };
  const service = new FundAccountsService(db, { allow: () => {} } as any);
  await assert.rejects(service.create(actor, body), /创建冲突/);
});

test("new initial payments default to the only account and historical references remain intact", async () => {
  const tx = { fundAccount: { findMany: async () => [account] } };
  for (const paid of [false, true]) {
    const payment: any = { paid };
    await defaultInitialAccount(tx, payment);
    assert.equal(payment.fundAccountId, account.id);
  }
  const history = { paid: true, fundAccountId: "historical" };
  await defaultInitialAccount(tx, history);
  assert.equal(history.fundAccountId, "historical");
});

test("paid orders cannot silently choose missing, disabled, mismatched or ambiguous accounts", async () => {
  for (const rows of [
    [],
    [{ ...account, enabled: false }],
    [{ ...account, bankName: "" }],
    [{ ...account, currency: "USD" }],
    [account, { ...account, id: "other" }],
  ]) {
    const tx = { fundAccount: { findMany: async () => rows } };
    await assert.rejects(
      defaultInitialAccount(tx, { paid: true }),
      /唯一且有效/,
    );
    await defaultInitialAccount(tx, { paid: false });
  }
});
