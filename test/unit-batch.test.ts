import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UnitsService } from "../src/modules/units/units.service";
import { AccessService } from "../src/common/auth/access.service";
const actor: any = { id: randomUUID(), name: "管理员", role: "SUPER_ADMIN" };
const projectId = randomUUID();
const type = { code: "L", name: "大单位", building: "A座", floor: "3", area: "40", layout: "两房", age: 3, minRent: "100", maxRent: "200" };
function fixture() {
  const state: any = { units: [], batches: [] };
  let failInsert = false;
  const db: any = { $transaction: async (fn: any) => {
    const snapshot = structuredClone(state);
    const tx: any = {
      $queryRawUnsafe: async () => [],
      project: { findFirst: async () => ({ id: projectId, typeConfigs: [type] }) },
      unit: {
        findMany: async () => state.units,
        findFirst: async ({ where }: any) => state.units.find((u: any) => u.projectId === where.projectId && where.OR.some((w: any) => w.unitNo ? u.unitNo === w.unitNo : u.building === w.building && u.floor === w.floor && u.roomNo === w.roomNo)),
        create: async ({ data }: any) => { if (failInsert && state.units.length === 1) throw new Error("disk failure"); const unit = { id: randomUUID(), ...data }; state.units.push(unit); return unit; },
      },
      unitCreationBatch: {
        findUnique: async ({ where }: any) => state.batches.find((b: any) => b.id === where.id),
        create: async ({ data }: any) => { state.batches.push(data); return data; },
      },
    };
    try { return await fn(tx); } catch (e) { Object.assign(state, snapshot); throw e; }
  } };
  return { state, service: new UnitsService(db, new AccessService(db), {} as any), fail: () => { failInsert = true; } };
}
function body() { return { requestId: randomUUID(), projectId, rows: ["01", "02"].map(roomNo => ({ roomNo, unitTypeCode: "L", referenceRent: "150" })) }; }
test("batch preview writes nothing; creation inherits metadata and audits each unit; retry returns the same units", async () => {
  const { service, state } = fixture(); const input = body();
  assert.equal((await service.batch(actor, input, true)).ok, true); assert.equal(state.units.length, 0);
  const result = await service.batch(actor, input); assert.equal(result.count, 2);
  for (const u of state.units) { assert.equal(u.floor, "3"); assert.equal(u.area, "40"); assert.equal(u.operationLogs[0].action, "CREATE"); }
  const retry = await service.batch(actor, input); assert.equal(retry.replayed, true); assert.deepEqual(retry.unitIds, result.unitIds); assert.equal(state.units.length, 2);
  await assert.rejects(service.batch(actor, { ...input, rows: [input.rows[0]] }), /重复提交编号冲突/);
  await assert.rejects(service.batch({ ...actor, id: randomUUID() }, input), /重复提交编号冲突/);
});
test("batch reports row errors and saves no valid subset", async () => {
  for (const patch of [{ roomNo: "01" }, { referenceRent: "999" }, { unitTypeCode: "UNKNOWN" }]) {
    const { service, state } = fixture(); const input = body(); Object.assign(input.rows[1], patch);
    const result = await service.batch(actor, input); assert.equal(result.ok, false); assert.equal(result.issues?.[0].row, 1); assert.equal(state.units.length, 0); assert.equal(state.batches.length, 0);
  }
});
test("existing and deleted unit room numbers cannot be recreated", async () => {
  const { service, state } = fixture(); await service.batch(actor, body()); state.units[0].deletedAt = new Date();
  const result = await service.batch(actor, body()); assert.equal(result.ok, false); assert.equal(result.issues?.length, 2); assert.equal(state.units.length, 2);
});
test("unexpected insertion failure rolls back entire batch and allows retry", async () => {
  const { service, state, fail } = fixture(); fail();
  await assert.rejects(service.batch(actor, body()), /disk failure/); assert.equal(state.units.length, 0); assert.equal(state.batches.length, 0);
});
test("batch only allows existing unit writers", async () => {
  const { service } = fixture();
  for (const role of ["SALES", "SALES_COMPANY_ADMIN", "FINANCE"]) await assert.rejects(service.batch({ ...actor, role }, body()), /无权/);
  assert.equal((await service.batch({ ...actor, role: "OPERATIONS" }, body())).ok, true);
});
test("strict batch schema rejects forged inherited fields, empty and oversized batches", async () => {
  const { service } = fixture(); const input = body();
  for (const rows of [[], Array.from({ length: 101 }, () => input.rows[0]), [{ ...input.rows[0], floor: "999" }]]) await assert.rejects(service.batch(actor, { ...input, rows }));
});
