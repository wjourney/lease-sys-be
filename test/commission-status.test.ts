import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { CommissionsService } from "../src/modules/commissions/commissions.service";

test("commission filters group partial and incomplete amounts under pending, excluding void by default", async () => {
  const scope = { salesCompanyId: "own-company" };
  const db: any = {
    commission: { findMany: async ({where}: any) => {
      assert.deepEqual(where.AND[1], scope);
      assert.deepEqual(where.AND[0].status, { not: "VOID" });
      return [{id:"unpaid",amount:"100"},{id:"partial",amount:"100"},{id:"paid",amount:"100"},{id:"unset",amount:null}];
    } },
    expense: { groupBy: async ({where}: any) => {
      assert.equal(where.deletedAt, null);
      assert.equal(where.status, "PAID");
      return [{commissionId:"partial",_sum:{paidAmount:"40"}},{commissionId:"paid",_sum:{paidAmount:"100"}}];
    } },
  };
  const service: any = new CommissionsService(db, { scope: async () => scope } as any);
  assert.deepEqual(await service.listConditions({}, {}), [{status:{not:"VOID"}}]);
  assert.deepEqual(await service.listConditions({}, {status:"OPEN"}), [{id:{in:["unpaid","partial","unset"]}}]);
  assert.deepEqual(await service.listConditions({}, {status:"PAID"}), [{id:{in:["paid"]}}]);
});

test("commission status stays pending until fully paid and preserves remaining money", async () => {
  const db: any = { expense: { findMany: async () => [{status:"PAID",paidAmount:"40",amount:"40"}] } };
  const service = new CommissionsService(db, { output: async (_a: any, _r: any, row: any) => ({...row}) } as any);
  const partial = await service.enrich({} as any, {id:"partial",status:"OPEN",amount:"100"});
  assert.equal(partial.status,"OPEN");
  assert.equal(partial.remainingAmount,"60");
  const paid = await service.enrich({} as any, {id:"paid",status:"OPEN",amount:"40"});
  assert.equal(paid.status,"PAID");
});
