import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  actorSnapshot,
  paymentActors,
  resolveOperationActors,
} from "../src/common/database/operation-actors";
import { event } from "../src/common/database/record-mutations";
import { ResourceQueryService } from "../src/common/resources/resource-query.service";

test("actor resolution batches current identities, preserves snapshots, and reads renames immediately", async () => {
  const user = {
    id: "a",
    name: "新姓名",
    phone: "19934287000",
    username: "login",
    deletedAt: null as Date | null,
  };
  const other = {
    id: "b",
    name: "新姓名",
    phone: "19934287001",
    username: "other",
    deletedAt: null,
  };
  let calls = 0;
  const db = {
    user: {
      findMany: async (query: any) => {
        calls++;
        assert.deepEqual(query.where, { id: { in: ["a", "b", "missing"] } });
        assert.deepEqual(Object.keys(query.select).sort(), [
          "deletedAt",
          "id",
          "name",
          "phone",
          "username",
        ]);
        return [user, other];
      },
    },
  };
  const actor: any = {
    id: "a",
    name: "旧姓名",
    phone: "19900000000",
    username: "old",
  };
  const log = event(actor, "UPDATE", { amount: "10" }, { amount: "20" });
  const logs = [
    log,
    log,
    { actorId: "b", actorName: "旧" },
    { actorId: "missing", actorName: "已删除姓名", actorPhone: "19911111111" },
  ];
  const original = JSON.stringify(logs);
  let resolved = await resolveOperationActors(db, logs);
  assert.equal(calls, 1);
  assert.equal(resolved[0].actorName, "新姓名");
  assert.equal(resolved[0].actorPhone, "19934287000");
  assert.equal(resolved[2].actorPhone, "19934287001");
  assert.equal(resolved[3].actorDeleted, true);
  assert.equal(resolved[3].actorName, "已删除姓名");
  user.name = "再次改名";
  user.deletedAt = new Date();
  resolved = await resolveOperationActors(db, logs);
  assert.equal(resolved[0].actorName, "再次改名");
  assert.equal(resolved[0].actorDeleted, true);
  assert.equal(JSON.stringify(logs), original);
});
test("system tasks never resolve the borrowed admin account and empty histories do not query", async () => {
  const db = {
    user: {
      findMany: () => {
        throw new Error("unexpected query");
      },
    },
  };
  assert.deepEqual(await resolveOperationActors(db, []), []);
  const records = await resolveOperationActors(db, [
    { ...actorSnapshot({ id: "admin", name: "管理员", system: true } as any) },
    { actorId: "admin", actorName: "系统任务" },
    { actorName: "历史用户" },
  ]);
  assert.equal(records[0].actorName, "系统");
  assert.equal(records[0].actorPhone, null);
  assert.equal(records[1].actorType, "SYSTEM");
  assert.equal(records[2].actorName, "历史用户");
});
test("resource authorization and change filtering precede identity lookup", async () => {
  class Query extends ResourceQueryService {
    readonly resource: string;
    constructor(resource: string, db: any, access: any) {
      super(db, access);
      this.resource = resource;
    }
  }
  const actor: any = { role: "SALES" };
  const raw = {
    operationLogs: [
      {
        actorId: "staff",
        actorName: "旧",
        changes: {
          unitSnapshot: {},
          salesSnapshot: {},
          monthlyRent: { after: "20" },
        },
      },
    ],
  };
  let queried = 0;
  const db: any = {
    user: {
      findMany: async () => {
        queried++;
        return [{ id: "staff", name: "现名", phone: null, username: "staff" }];
      },
    },
  };
  const access: any = { get: async () => raw };
  assert.deepEqual(
    await new Query("projects", db, access).operations(actor, "id"),
    [],
  );
  assert.equal(queried, 0);
  const logs = await new Query("orders", db, access).operations(actor, "id");
  assert.deepEqual(Object.keys(logs[0].changes), ["monthlyRent"]);
  assert.equal(logs[0].actorUsername, "staff");
  access.get = async () => {
    throw new Error("forbidden");
  };
  await assert.rejects(
    new Query("orders", db, access).operations(actor, "id"),
    /forbidden/,
  );
  assert.equal(queried, 1);
});
test("legacy payments recover IDs from append events, never by matching a name", () => {
  const first = { amount: "10", operator: "同名", sourceKey: "first" };
  const second = { amount: "20", operator: "同名", sourceKey: "second" };
  const logs = [
    {
      actorId: "a",
      actorName: "同名",
      changes: { paymentRecords: { before: [], after: [first] } },
    },
    {
      actorId: "b",
      actorName: "同名",
      changes: { paymentRecords: { before: [first], after: [first, second] } },
    },
  ];
  assert.deepEqual(
    paymentActors([first, second], logs, false).map((r) => r.actorId),
    ["a", "b"],
  );
  assert.equal(paymentActors([first], [], false)[0].actorId, undefined);
  assert.equal(
    paymentActors(
      [first],
      [{ actorId: "a", changes: { paidAmount: { before: "0", after: "10" } } }],
      true,
    )[0].actorId,
    "a",
  );
});
