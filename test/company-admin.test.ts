import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { AccessService } from "../src/common/auth/access.service";
import { capabilities } from "../src/common/auth/permissions";
import { delegate } from "../src/common/resources/resource-map";
import { SalesCompaniesService } from "../src/modules/sales-companies/sales-companies.service";
import { ReceiptsService } from "../src/modules/incomes/receipts.service";
import { MaterialsService } from "../src/modules/materials/materials.service";
import {
  CompanyCommissionsService,
  CompanyCommissionQuery,
} from "../src/modules/commissions/company-commissions.service";
import { number } from "../src/common/utils/value";

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const actor: any = {
  id: uuid(1),
  role: "SALES_COMPANY_ADMIN",
  salesCompanyId: uuid(2),
  name: "公司管理员",
};
const query = { from: "2026-01-01", to: "2026-03-31" };

test("company administrator writes only company info; super admin stays unchanged and sales is read-only", () => {
  const access = new AccessService({} as any);
  for (const r of Object.keys(delegate)) {
    if (r !== "sales-companies")
      assert.throws(() => access.allow(actor, r, true));
    access.allow({ ...actor, role: "SUPER_ADMIN" }, r, true);
  }
  access.allow(actor, "sales-companies", true);
  for (const r of Object.keys(delegate))
    assert.throws(() => access.allow({ ...actor, role: "SALES" }, r, true));
  for (const r of ["settings", "fund-accounts", "expenses"])
    assert.throws(() => access.allow(actor, r));
  assert.deepEqual(
    capabilities({ ...actor, role: "SUPER_ADMIN" }).write,
    Object.keys(delegate),
  );
});

test("read scope is fixed to the signed-in company despite client filters", async () => {
  const tx = {
    order: {
      findMany: async ({ where }: any) => {
        assert.equal(where.salesCompanyId, actor.salesCompanyId);
        return [{ id: uuid(3) }];
      },
    },
  };
  const access = new AccessService(tx as any);
  assert.deepEqual(await access.scope(actor, "orders"), {
    id: { in: [uuid(3)] },
  });
  assert.deepEqual(await access.scope(actor, "users"), {
    salesCompanyId: actor.salesCompanyId,
  });
  assert.deepEqual(await access.scope(actor, "sales-companies"), {
    id: actor.salesCompanyId,
  });
  assert.deepEqual(
    await access.scope({ ...actor, role: "SUPER_ADMIN" }, "orders"),
    {},
  );
});

test("company administrators cannot create/delete companies or edit protected fields/other companies", async () => {
  const service: any = new SalesCompaniesService({} as any, {} as any);
  await assert.rejects(service.create(actor, {}));
  await assert.rejects(service.remove(actor, actor.salesCompanyId, "删除"));
  const own = { id: actor.salesCompanyId };
  await service.beforeEdit(actor, { name: "新公司名", phone: "123" }, {}, own);
  for (const key of ["status", "serviceEndsOn", "branches", "positions"]) {
    await assert.rejects(
      service.beforeEdit(actor, { [key]: "changed" }, {}, own),
    );
  }
  await assert.rejects(
    service.beforeEdit(actor, { name: "changed" }, {}, { id: uuid(9) }),
  );
  await service.beforeEdit(
    { ...actor, role: "SUPER_ADMIN" },
    { status: "DISABLED" },
    {},
    own,
  );
});

test("company administrators cannot register, allocate, approve or withdraw receipts", async () => {
  const s = new ReceiptsService({} as any, {} as any, {} as any, {} as any);
  await assert.rejects(s.receipt(actor, uuid(3), {}), /无权/);
  await assert.rejects(s.batch(actor, uuid(3), {}), /无权/);
  await assert.rejects(s.undo(actor, uuid(3), { reason: "撤回" }), /无权/);
  await assert.rejects(s.confirm(actor, uuid(3), true), /无权/);
});

test("material uploads permit own company pictures only", async () => {
  const s: any = new MaterialsService(
    {} as any,
    { get: async () => ({}) } as any,
    {} as any,
  );
  await s.validate(
    actor,
    { salesCompanyId: actor.salesCompanyId, category: "PHOTO" },
    {},
  );
  for (const data of [
    { salesCompanyId: uuid(99), category: "PHOTO" },
    { orderId: uuid(3), category: "PHOTO" },
    { projectId: uuid(3), category: "PHOTO" },
    { salesCompanyId: actor.salesCompanyId, category: "CONTRACT" },
  ])
    await assert.rejects(s.validate(actor, data, {}), /无权/);
});

function fixture(employeeScope = false) {
  const employee = uuid(4),
    orderId = uuid(3);
  const records = [
    [10, "2026-01-15", "100.10", "OPEN"],
    [11, "2026-02-15", "100.10", "OPEN"],
    [12, "2026-02-16", "999", "VOID"],
    [13, "2026-03-15", null, "OPEN"],
  ].map(([id, due, amount, status]) => ({
    id: uuid(Number(id)),
    orderId,
    salesCompanyId: actor.salesCompanyId,
    salesUserId: employee,
    commissionNo: `C${id}`,
    amount: amount === null ? null : number(amount),
    status,
    currency: "HKD",
    dueOn: new Date(String(due)),
    mode: "RECURRING_MONTHLY",
    periodStart: new Date(String(due)),
    periodEnd: new Date(String(due)),
  }));
  const tx = {
    order: {
      findMany: async ({ where }: any) => {
        assert.equal(where.salesCompanyId, actor.salesCompanyId);
        if (employeeScope) assert.equal(where.salesUserId, employee);
        return [
          { id: orderId, orderNo: "O1", projectId: uuid(5), unitId: uuid(6) },
        ];
      },
    },
    commission: {
      findMany: async ({ where }: any) => {
        assert.equal(where.salesCompanyId, actor.salesCompanyId);
        assert.deepEqual(where.orderId, { in: [orderId] });
        if (employeeScope) assert.equal(where.salesUserId, employee);
        if (where.id) return records.filter((r) => r.id === where.id);
        assert.equal(where.currency, "HKD");
        assert.equal(where.dueOn.gte.toISOString().slice(0, 10), query.from);
        return records;
      },
    },
    user: { findMany: async () => [{ id: employee, name: "员工甲" }] },
    project: { findMany: async () => [{ id: uuid(5), name: "项目" }] },
    unit: { findMany: async () => [{ id: uuid(6), unitNo: "A101" }] },
    expense: {
      findMany: async ({ where }: any) => {
        assert.equal(where.status.not, "VOID");
        return [
          {
            commissionId: uuid(10),
            expenseNo: "E1",
            currency: "HKD",
            paidAmount: number("30.05"),
            paidOn: new Date("2026-01-16"),
          },
        ];
      },
    },
  };
  return new CompanyCommissionsService({
    $transaction: async (run: any) => run(tx),
  } as any);
}

test("quarter statistics sum individual installments, exclude void, count distinct orders, preserve decimal precision", async () => {
  const result = await fixture().list(actor, { ...query, pageSize: 1 });
  assert.equal(result.items.length, 1);
  assert.equal(result.total, 3);
  assert.deepEqual(result.summary, {
    amount: "200.20",
    paidAmount: "30.05",
    remainingAmount: "170.15",
    orderCount: 1,
    unsetCount: 1,
  });
  assert.deepEqual(
    result.trend.map((r) => r.amount),
    ["100.10", "100.10", "0.00"],
  );
  assert.equal(result.staff[0].months["2026-02"], "100.10");
  assert.equal(result.items[0].status, "OPEN");
});

test("company commission details reject foreign IDs, reject client-selected companies and unauthorized roles", async () => {
  const service = fixture();
  assert.equal(
    CompanyCommissionQuery.safeParse({ ...query, salesCompanyId: uuid(99) })
      .success,
    false,
  );
  await assert.rejects(service.detail(actor, uuid(99)), /不存在/);
  for (const role of ["FINANCE", "SUPER_ADMIN"])
    await assert.rejects(service.list({ ...actor, role }, query), /无权/);
  await assert.rejects(
    service.list({ ...actor, salesCompanyId: null }, query),
    /无权/,
  );
  const detail = await service.detail(actor, uuid(10));
  assert.equal(detail.payments?.length, 1);
  assert.equal("fundAccountId" in detail, false);
});

test("employee commission scope is enforced for list, drilldown and detail", async () => {
  const employeeActor = { ...actor, role: "SALES", id: uuid(4) };
  const service = fixture(true);
  const result = await service.list(employeeActor, query);
  assert.equal(result.summary.amount, "200.20");
  assert.ok(result.items.every((r) => r.salesUserId === employeeActor.id));
  await assert.rejects(
    service.list(employeeActor, { ...query, salesUserId: uuid(99) }),
  );
  assert.equal(
    (await service.detail(employeeActor, uuid(10))).salesUserId,
    employeeActor.id,
  );
  await assert.rejects(service.detail(employeeActor, uuid(99)));
  const access = new AccessService({
    order: {
      findMany: async ({ where }: any) => {
        assert.equal(where.salesUserId, employeeActor.id);
        return [{ id: uuid(3) }];
      },
    },
  } as any);
  assert.deepEqual(await access.scope(employeeActor, "commissions"), {
    orderId: { in: [uuid(3)] },
    salesUserId: employeeActor.id,
  });
  assert.deepEqual(await access.scope(employeeActor, "users"), {
    salesCompanyId: employeeActor.salesCompanyId,
  });
});

test("operations has business and system writes without financial approval rights", () => {
  const access = new AccessService({} as any);
  const ops = { ...actor, role: "OPERATIONS" };
  for (const r of [
    "projects",
    "units",
    "orders",
    "users",
    "sales-companies",
    "settings",
    "fund-accounts",
    "materials",
  ])
    access.allow(ops, r, true);
  for (const r of ["incomes", "expenses", "commissions", "invoices"])
    assert.throws(() => access.allow(ops, r, true));
  assert.equal(capabilities(ops).finance, false);
  assert.equal(capabilities(ops).manageOrders, true);
});

test("employees cannot register payments or upload business attachments", async () => {
  const employeeActor = { ...actor, role: "SALES" };
  const receipts = new ReceiptsService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );
  await assert.rejects(receipts.receipt(employeeActor, uuid(3), {}));
  await assert.rejects(receipts.batch(employeeActor, uuid(3), {}));
  await assert.rejects(
    receipts.undo(employeeActor, uuid(3), { reason: "test" }),
  );
  const materials: any = new MaterialsService({} as any, {} as any, {} as any);
  await assert.rejects(
    materials.validate(
      employeeActor,
      { salesCompanyId: actor.salesCompanyId, category: "PHOTO" },
      {},
    ),
  );
});
