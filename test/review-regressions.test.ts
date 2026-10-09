import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { ProjectsService } from "../src/modules/projects/projects.service";
import { AccessService } from "../src/common/auth/access.service";
import { AuthService } from "../src/modules/auth/auth.service";
import { AuthGuard } from "../src/modules/auth/auth.guard";
import { hashPassword } from "../src/common/auth/password";
const actor: any = { id: randomUUID(), name: "运营", role: "OPERATIONS" };
const type = { code: "L", name: "大单位", building: "B座", floor: "15", area: "40", layout: "两房", minRent: "100", maxRent: "200", referenceRent: "150" };
test("project list and detail redact type rents server-side without changing internal data", async () => {
  const project = { id: randomUUID(), name: "项目", typeConfigs: [type], salesCanViewExactRent: false };
  const calls = { units: 0, orders: 0, images: 0 };
  const db: any = {
    project: { findMany: async () => [project], count: async () => 1 },
    unit: { findMany: async () => { calls.units++; return []; } },
    order: { findMany: async () => { calls.orders++; return []; } },
    material: { findMany: async () => { calls.images++; return []; }, findFirst: async () => null },
    systemSetting: { findUnique: async () => null },
  };
  const access = new AccessService(db);
  const service = new ProjectsService(db, access, {} as any);
  const sales: any = { ...actor, role: "SALES" };
  const list = await service.list(sales);
  assert.equal(list.items[0].typeConfigs[0].referenceRent, undefined);
  assert.equal(list.items[0].typeConfigs[0].minRent, "100");
  assert.deepEqual(calls, { units: 1, orders: 1, images: 1 });
  assert.equal((await service.enrich(actor, project)).typeConfigs[0].referenceRent, "150");
  assert.equal(project.typeConfigs[0].referenceRent, "150");
  const visible = await service.enrich(sales, { ...project, salesCanViewExactRent: true });
  assert.equal(visible.typeConfigs[0].referenceRent, "150");
});
test("type address editing synchronizes live unit name while retaining historical snapshots", async () => {
  const unit = { id: randomUUID(), revision: 1, unitTypeCode: "L", unitNo: "A座 12楼 01", roomNo: "01", building: "A座", floor: "12", extra: {} };
  const tx: any = { unit: {
    count: async () => 0, findMany: async () => [unit],
    updateMany: async ({ data }: any) => { Object.assign(unit, data); return { count: 1 }; },
    findUnique: async () => unit,
  } };
  const service = new ProjectsService(tx, {} as any, {} as any);
  await (service as any).validate(actor, { typeConfigs: [type] }, tx, { id: randomUUID() });
  assert.equal(unit.unitNo, "B座 15楼 01");
  assert.equal(unit.floor, "15");
});
test("deleted child units no longer prevent project deletion; live units still do", async () => {
  const project = { id: randomUUID(), revision: 1 };
  let live = false;
  const db: any = { $queryRawUnsafe: async () => [], $transaction: async (fn: any) => fn(db),
    unit: { count: async ({ where }: any) => { assert.equal(where.deletedAt, null); return live ? 1 : 0; } },
    project: { updateMany: async () => ({ count: 1 }), findUnique: async () => project },
  };
  const service = new ProjectsService(db, { allow: () => {}, get: async () => project } as any, {} as any);
  live = true;
  await assert.rejects(service.remove(actor, project.id, "清理项目"), /请先删除项目下的单位/);
  live = false;
  await service.remove(actor, project.id, "清理项目");
});
test("legacy company disable flag does not block login, while member and service restrictions remain", async () => {
  process.env.JWT_SECRET ??= "review-test-only-jwt-secret-at-least-32-characters";
  const user: any = { id: randomUUID(), role: "SALES", username: "sales", name: "销售", authVersion: 1, status: "ACTIVE", salesCompanyId: randomUUID(), passwordHash: hashPassword("test-password") };
  const company: any = { id: user.salesCompanyId, status: "DISABLED" };
  const db: any = { user: { findUnique: async () => user, update: async () => user }, salesCompany: { findUnique: async () => company } };
  const service = new AuthService(db);
  const session = await service.login({ username: user.username, password: "test-password" }, "test-ip");
  const req = { cookies: { lease_session: session.token }, method: "GET" };
  const ctx: any = { getHandler: () => null, getClass: () => null, switchToHttp: () => ({ getRequest: () => req }) };
  const guard = new AuthGuard(db, { getAllAndOverride: () => false } as any);
  assert.equal(await guard.canActivate(ctx), true);
  user.status = "DISABLED";
  await assert.rejects(guard.canActivate(ctx));
  await assert.rejects(service.login({ username: user.username, password: "test-password" }, "test-ip-2"));
  user.status = "ACTIVE";
  company.serviceEndsOn = new Date("2020-01-01");
  await assert.rejects(guard.canActivate(ctx));
  await assert.rejects(service.login({ username: user.username, password: "test-password" }, "test-ip-3"));
});
