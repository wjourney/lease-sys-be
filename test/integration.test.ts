import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomInt, randomUUID } from "node:crypto";
const base = process.env.TEST_API_URL || "http://127.0.0.1:3002/api/v1";
if (!base.includes(":3002/"))
  throw new Error(
    "Integration tests require dedicated test server on port 3002",
  );
class Client {
  cookies = "";
  csrf = "";
  async call(method: string, path: string, body?: any, expected = 200) {
    const r = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Cookie: this.cookies,
        "X-CSRF-Token": this.csrf,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const ct = r.headers.get("content-type") || "";
    const data = ct.includes("json") ? await r.json() : await r.text();
    assert.equal(
      r.status,
      expected,
      `${method} ${path}: ${JSON.stringify(data)}`,
    );
    return data as any;
  }
  async login(
    username: string,
    password = process.env.SEED_PASSWORD || "ChangeMe123!",
    expected = 201,
  ) {
    const r = await fetch(base + "/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username,
        password,
      }),
    });
    assert.equal(r.status, expected);
    if (expected !== 201) return await r.json();
    const cookies = r.headers.getSetCookie().map((x) => x.split(";")[0]);
    this.cookies = cookies.join("; ");
    this.csrf = cookies.find((x) => x.startsWith("lease_csrf="))!.split("=")[1];
    return await r.json();
  }
}
const admin = new Client(),
  sales = new Client(),
  other = new Client(),
  finance = new Client(),
  operations = new Client(),
  company = new Client();
let a: any,
  sa: any,
  fi: any,
  order: any,
  root: any,
  account: any,
  receipt: any,
  invoice: any,
  commission: any;
before(async () => {
  a = await admin.login("admin");
  sa = await sales.login("sales");
  await other.login("sales.other");
  fi = await finance.login("finance");
  await operations.login("operations");
  await company.login("company");
  order = (await sales.call("GET", "/orders")).items[0];
  root = (await sales.call("GET", "/incomes?orderId=" + order.id)).items.find(
    (x) => x.feeType === "RENT",
  );
  account = (await finance.call("GET", "/fund-accounts")).items[0];
});
test("full workflow and authorization invariants", async (t) => {
  await t.test("order bill read model is paged, scoped and searchable by order number", async () => {
    const q = `/incomes/bills?q=${encodeURIComponent(order.orderNo)}&pageSize=1`;
    const first = await sales.call("GET", q);
    assert.ok(first.total >= 2);
    assert.equal(first.items.length, 1);
    assert.equal(first.items[0].orderId, order.id);
    assert.ok(Number(first.summary.rental.total) > 0);
    assert.ok(Number(first.summary.deposit.total) > 0);
    const second = await sales.call("GET", q + "&page=2");
    assert.deepEqual(second.summary, first.summary);
    assert.notEqual(second.items[0].id, first.items[0].id);
    assert.equal((await other.call("GET", q)).total, 0);
    const detail = await sales.call("GET", `/incomes/${first.items[0].id}`);
    assert.ok(Array.isArray(detail.receipts));
    assert.ok(Array.isArray(detail.offsets));
    assert.ok(Array.isArray(detail.operations));
    await sales.call("GET", "/incomes/bills?from=2026-02-30", undefined, 400);
    assert.equal((await sales.call("GET", "/incomes/bills?currency=USD")).total, 0);
  });
  await t.test("employee reads own company and own commission reports but cannot mutate business data", async () => {
    const companies = await sales.call("GET", "/sales-companies");
    assert.equal(companies.total, 1);
    assert.equal(companies.items[0].id, sa.salesCompanyId);
    await sales.call("PATCH", `/sales-companies/${sa.salesCompanyId}`, { revision: companies.items[0].revision, name: "forbidden" }, 403);
    await sales.call("POST", "/orders", {}, 403);
    await sales.call("POST", `/incomes/${root.id}/receipts`, {}, 403);
    const q = "/company-commissions?from=2026-01-01&to=2028-12-31";
    const commissions = await sales.call("GET", q);
    assert.ok(commissions.items.every((r: any) => r.salesUserId === sa.id));
    assert.ok(commissions.employees.every((r: any) => r.id === sa.id));
    await sales.call("GET", q + "&salesUserId=" + a.id, undefined, 403);
    for (const path of ["/settings", "/fund-accounts"]) await sales.call("GET", path, undefined, 403);
    const me = await operations.call("GET", "/auth/me");
    for (const r of ["users", "settings", "fund-accounts", "sales-companies", "projects", "orders"]) assert.ok(me.capabilities.write.includes(r));
    assert.equal(me.capabilities.finance, false);
  });
  await t.test("five roles and company scopes", async () => {
    assert.equal((await admin.call("GET", "/users")).total, 6);
    const mine = await sales.call("GET", "/orders");
    assert.equal(mine.total, 2);
    assert.equal((await other.call("GET", "/orders")).total, 1);
    await other.call("GET", "/orders/" + order.id, undefined, 404);
    await sales.call("GET", "/expenses", undefined, 403);
    await company.call(
      "POST",
      "/users",
      {
        password: "Password123!",
        name: "Forbidden",
        phone: "13800000000",
        role: "SUPER_ADMIN",
      },
      403,
    );
  });
  await t.test("members can edit only their own personal details", async () => {
    await sales.call(
      "PATCH",
      "/auth/me",
      {
        name: sa.name,
        nameEn: "Profile Test",
        phone: "13800001234",
        email: "profile@example.com",
        role: "SUPER_ADMIN",
      },
      400,
    );
    const updated = await sales.call("PATCH", "/auth/me", {
      name: sa.name,
      nameEn: "Profile Test",
      phone: "13800001234",
      email: "profile@example.com",
    });
    assert.equal(updated.nameEn, "Profile Test");
    assert.equal(updated.role, "SALES");
    assert.equal((await sales.call("GET", "/auth/me")).phone, "13800001234");
    assert.equal(
      (await admin.call("GET", `/users/${sa.id}`)).email,
      "profile@example.com",
    );
  });
  await t.test(
    "member account creation, password reset and disable",
    async () => {
      const username = `13${randomInt(100_000_000, 1_000_000_000)}`;
      const created = await operations.call(
        "POST",
        "/users",
        {
          name: "测试成员",
          phone: username,
          role: "OPERATIONS",
          status: "ACTIVE",
        },
        201,
      );
      assert.equal(created.username, username);
      assert.ok(created.initialPassword?.length >= 10);
      await operations.call(
        "POST",
        "/users",
        { name: "重复手机号", phone: username, role: "OPERATIONS" },
        409,
      );
      await operations.call(
        "POST",
        "/users",
        {
          username: "different",
          name: "登录账号不一致",
          phone: "13800001111",
          role: "OPERATIONS",
        },
        400,
      );
      const createdDetail = await operations.call("GET", `/users/${created.id}`);
      await operations.call(
        "PATCH",
        `/users/${created.id}`,
        { revision: createdDetail.revision, phone: "13800001111" },
        400,
      );
      const expiring = await operations.call("PATCH", `/users/${created.id}`, {
        revision: createdDetail.revision,
        expiresAt: "2027-10-01",
      });
      const ongoing = await operations.call("PATCH", `/users/${created.id}`, {
        revision: expiring.revision,
        expiresAt: null,
      });
      assert.equal(ongoing.expiresAt, null);
      const member = new Client();
      await member.login(username, created.initialPassword);
      await member.call(
        "PATCH",
        "/auth/me",
        { name: created.name, nameEn: "", phone: "13800001111", email: "" },
        400,
      );
      const avatarData = new FormData();
      avatarData.append(
        "file",
        new Blob(
          [
            Buffer.from(
              "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2J0AAAAASUVORK5CYII=",
              "base64",
            ),
          ],
          {
            type: "image/png",
          },
        ),
        "avatar.png",
      );
      const avatarUpload = await fetch(base + `/users/${created.id}/avatar`, {
        method: "POST",
        headers: { Cookie: member.cookies, "X-CSRF-Token": member.csrf },
        body: avatarData,
      });
      assert.equal(avatarUpload.status, 201, await avatarUpload.text());
      const otherAvatar = new FormData();
      otherAvatar.append(
        "file",
        new Blob([Buffer.from("89504e470d0a1a0a", "hex")], {
          type: "image/png",
        }),
        "avatar.png",
      );
      const forbiddenUpload = await fetch(base + `/users/${a.id}/avatar`, {
        method: "POST",
        headers: { Cookie: sales.cookies, "X-CSRF-Token": sales.csrf },
        body: otherAvatar,
      });
      assert.equal(forbiddenUpload.status, 403);
      assert.equal(
        (await operations.call("GET", `/users/${created.id}`)).avatarUrl,
        `/api/v1/users/${created.id}/avatar`,
      );
      const avatarImage = await fetch(base + `/users/${created.id}/avatar`, {
        headers: { Cookie: member.cookies },
      });
      assert.equal(avatarImage.status, 200);
      assert.equal(avatarImage.headers.get("content-type"), "image/png");
      const reset = await operations.call(
        "POST",
        `/users/${created.id}/reset-password`,
        {},
        201,
      );
      assert.ok(reset.initialPassword?.length >= 10);
      assert.notEqual(reset.initialPassword, created.initialPassword);
      await member.call("GET", "/auth/me", undefined, 401);
      await member.login(username, created.initialPassword, 401);
      await member.login(username, reset.initialPassword);
      await company.call(
        "POST",
        `/users/${sa.id}/disable`,
        { reason: "无权停用" },
        403,
      );
      const salesMember = await company.call("GET", `/users/${sa.id}`);
      await company.call(
        "PATCH",
        `/users/${sa.id}`,
        {
          revision: salesMember.revision,
          status: "DISABLED",
          reason: "无权停用",
        },
        403,
      );
      const secondAdmin = await operations.call(
        "POST",
        "/users",
        {
          name: "第二位管理员",
          phone: `13${randomInt(100_000_000, 1_000_000_000)}`,
          role: "SUPER_ADMIN",
          status: "ACTIVE",
        },
        201,
      );
      const disabledAdmin = await operations.call(
        "POST",
        `/users/${secondAdmin.id}/disable`,
        { reason: "测试停用其他管理员" },
        201,
      );
      assert.equal(disabledAdmin.status, "DISABLED");
      const enabledAdmin = await operations.call(
        "PATCH",
        `/users/${secondAdmin.id}`,
        {
          revision: disabledAdmin.revision,
          status: "ACTIVE",
          reason: "测试重新启用其他管理员",
        },
      );
      const patchedAdmin = await operations.call(
        "PATCH",
        `/users/${secondAdmin.id}`,
        {
          revision: enabledAdmin.revision,
          status: "DISABLED",
          reason: "测试通过编辑停用其他管理员",
        },
      );
      assert.equal(patchedAdmin.status, "DISABLED");
      await operations.call(
        "DELETE",
        `/users/${secondAdmin.id}`,
        { reason: "测试删除其他管理员" },
      );
      await operations.call("GET", `/users/${secondAdmin.id}`, undefined, 404);
      await admin.call(
        "POST",
        `/users/${a.id}/disable`,
        { reason: "不能停用自己" },
        400,
      );
      await admin.call(
        "DELETE",
        `/users/${a.id}`,
        { reason: "不能删除自己" },
        400,
      );
      const disabled = await operations.call(
        "POST",
        `/users/${created.id}/disable`,
        { reason: "测试停用" },
        201,
      );
      assert.equal(disabled.status, "DISABLED");
      await member.call("GET", "/auth/me", undefined, 401);
      await member.login(username, reset.initialPassword, 401);
    },
  );
  await t.test("price field permission and CSRF", async () => {
    const rows = (await sales.call("GET", "/units?pageSize=100")).items;
    const hidden = rows.find((x) => x.projectName === "海棠里项目");
    assert(hidden);
    assert.equal(hidden.referenceRent, undefined);
    const searched = await admin.call(
      "GET",
      `/units?projectId=${hidden.projectId}&page=1&pageSize=9&q=88&status=`,
    );
    assert(Array.isArray(searched.items));
    const caseInsensitive = await admin.call(
      "GET",
      `/units?projectId=${hidden.projectId}&q=a`,
    );
    assert.equal(caseInsensitive.total, 4);
    const projectDetail = await sales.call("GET", "/projects/" + hidden.projectId);
    assert.deepEqual(projectDetail.operations, []);
    const orderDetail = await sales.call("GET", "/orders/" + order.id);
    assert(
      orderDetail.operations.every(
        (entry: any) =>
          !("unitSnapshot" in (entry.changes || {})) &&
          !("salesSnapshot" in (entry.changes || {})),
      ),
    );
    const token = sales.csrf;
    sales.csrf = "invalid";
    await sales.call("POST", "/incomes/" + root.id + "/receipts", {}, 403);
    sales.csrf = token;
  });
  await t.test(
    "receipt immediately settles balance and duplicate key is idempotent",
    async () => {
      const body = {
        amount: "1000",
        receivedOn: "2026-09-29",
        fundAccountId: account.id,
        paymentMethod: "BANK",
        payerName: order.tenantName,
        sourceKey: randomUUID(),
      };
      receipt = await operations.call(
        "POST",
        "/incomes/" + root.id + "/receipts",
        body,
        201,
      );
      const same = await operations.call(
        "POST",
        "/incomes/" + root.id + "/receipts",
        body,
        201,
      );
      assert.equal(same.id, receipt.id);
      const detail = await sales.call("GET", "/incomes/" + root.id);
      assert.equal(Number(detail.pending), 0);
      assert.equal(Number(detail.confirmed), 1000);
      await sales.call("POST", "/incomes/" + receipt.id + "/confirm", {}, 403);
    },
  );
  await t.test("direct receipt creates one invoice and confirmation retries are idempotent", async () => {
    await finance.call("POST", "/incomes/" + receipt.id + "/confirm", {}, 201);
    await finance.call("POST", "/incomes/" + receipt.id + "/confirm", {}, 201);
    const invs = await finance.call("GET", "/invoices?incomeId=" + receipt.id);
    assert.equal(invs.total, 1);
    invoice = invs.items[0];
    const detail = await finance.call("GET", "/incomes/" + root.id);
    assert.equal(Number(detail.confirmed), 1000);
    assert.equal(Number(detail.pending), 0);
    assert.equal(detail.status, "OPEN");
    await other.call("GET", "/invoices/" + invoice.id, undefined, 404);
  });
  await t.test(
    "income records cannot be patched or adjusted through public endpoints",
    async () => {
      await admin.call(
        "DELETE",
        "/incomes/" + receipt.id,
        { reason: "test" },
        404,
      );
      const d = await admin.call("GET", "/incomes/" + root.id);
      await admin.call(
        "PATCH",
        "/incomes/" + root.id,
        { revision: d.revision, amount: "1" },
        404,
      );
      await finance.call(
        "POST",
        "/incomes/" + root.id + "/adjust",
        { revision: d.revision, amount: "10", reason: "test" },
        404,
      );
    },
  );
  await t.test(
    "concurrent receipts cannot exceed available balance",
    async () => {
      const d = await sales.call("GET", "/incomes/" + root.id);
      const send = async () => {
        const r = await fetch(base + "/incomes/" + root.id + "/receipts", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: operations.cookies,
            "X-CSRF-Token": operations.csrf,
          },
          body: JSON.stringify({
            amount: d.available,
            receivedOn: "2026-09-29",
            fundAccountId: account.id,
            paymentMethod: "BANK",
            payerName: "Test",
            sourceKey: randomUUID(),
          }),
        });
        return { status: r.status, body: (await r.json()) as any };
      };
      const results = await Promise.all([send(), send()]);
      assert.deepEqual(results.map((x) => x.status).sort(), [201, 400]);
      const pending = results.find((x) => x.status === 201)!.body;
      await finance.call(
        "POST",
        "/incomes/" + pending.id + "/reverse",
        { reason: "凭证需重新提交" },
        201,
      );
      const next = await sales.call("GET", "/incomes/" + root.id);
      assert.equal(next.available, d.available);
    },
  );
  await t.test("confirmed first rent and deposit activate order", async () => {
    const roots = (await sales.call("GET", "/incomes?orderId=" + order.id))
      .items;
    for (const r of roots) {
      const d = await sales.call("GET", "/incomes/" + r.id);
      if (Number(d.available) > 0) {
        const receipt = await operations.call(
          "POST",
          "/incomes/" + r.id + "/receipts",
          {
            amount: d.available,
            receivedOn: "2026-09-29",
            fundAccountId: account.id,
            paymentMethod: "BANK",
            payerName: "Test",
            sourceKey: randomUUID(),
          },
          201,
        );
        await finance.call(
          "POST",
          "/incomes/" + receipt.id + "/confirm",
          {},
          201,
        );
      }
    }
    assert.equal(
      (await sales.call("GET", "/orders/" + order.id)).status,
      "ACTIVE",
    );
  });
  await t.test(
    "commission payments do not duplicate and cannot exceed balance",
    async () => {
      commission = (
        await finance.call("GET", "/commissions?orderId=" + order.id)
      ).items[0];
      if (commission.amount == null) {
        commission = await finance.call(
          "PATCH",
          "/commissions/" + commission.id,
          { revision: commission.revision, amount: "1200" },
        );
      }
      const body = {
        amount: "600",
        paidOn: "2026-09-29",
        fundAccountId: account.id,
        paymentMethod: "BANK",
        sourceKey: randomUUID(),
      };
      const e = await finance.call(
        "POST",
        "/commissions/" + commission.id + "/payments",
        body,
        201,
      );
      assert.equal(
        (
          await finance.call(
            "POST",
            "/commissions/" + commission.id + "/payments",
            body,
            201,
          )
        ).id,
        e.id,
      );
      assert.equal(
        Number(
          (await finance.call("GET", "/commissions/" + commission.id))
            .paidAmount,
        ),
        600,
      );
      await finance.call(
        "POST",
        "/commissions/" + commission.id + "/payments",
        { ...body, amount: "99999", sourceKey: randomUUID() },
        400,
      );
    },
  );
  await t.test(
    "invoice reissue preserves receipt and unique active invoice",
    async () => {
      const replacement = await finance.call(
        "POST",
        "/invoices/" + invoice.id + "/reissue",
        { reason: "重新开具" },
        201,
      );
      assert.equal(replacement.incomeId, receipt.id);
      const rows = (
        await finance.call("GET", "/invoices?incomeId=" + receipt.id)
      ).items;
      assert.equal(rows.filter((x) => x.status === "ACTIVE").length, 1);
      assert.equal(rows.length, 2);
      assert.equal(
        (await finance.call("GET", "/incomes/" + receipt.id)).status,
        "CONFIRMED",
      );
      invoice = replacement;
    },
  );
  await t.test(
    "PDF is generated from real invoice data and protected by ownership",
    async () => {
      let m: any;
      const response = await fetch(
        base + "/invoices/" + invoice.id + "/render",
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Cookie: finance.cookies,
            "X-CSRF-Token": finance.csrf,
          },
          body: "{}",
        },
      );
      if (response.status === 201) m = await response.json();
      else {
        for (let i = 0; i < 30; i++) {
          const list = await finance.call(
            "GET",
            "/materials?invoiceId=" + invoice.id,
          );
          if (list.items[0]) {
            m = list.items[0];
            break;
          }
          await new Promise((r) => setTimeout(r, 200));
        }
      }
      assert(m?.id);
      const r = await fetch(base + "/materials/" + m.id + "/download", {
        headers: { Cookie: finance.cookies },
      });
      assert.equal(r.status, 200);
      assert.equal(
        Buffer.from(await r.arrayBuffer())
          .subarray(0, 4)
          .toString(),
        "%PDF",
      );
      await other.call("GET", "/materials/" + m.id, undefined, 404);
    },
  );
  await t.test(
    "termination, handover and deposit settlement are distinct",
    async () => {
      await operations.call(
        "POST",
        "/orders/" + order.id + "/terminate",
        { date: "2027-08-31", reason: "提前退租" },
        201,
      );
      assert.notEqual(
        (await admin.call("GET", "/orders/" + order.id)).occupancyState,
        "RELEASED",
      );
      await operations.call(
        "POST",
        "/orders/" + order.id + "/handover",
        { note: "钥匙及物品核对完成" },
        201,
      );
      assert.equal(
        (await admin.call("GET", "/orders/" + order.id)).occupancyState,
        "RELEASED",
      );
      await finance.call(
        "POST",
        "/orders/" + order.id + "/deposit-settlement",
        { deductionAmount: "100", reason: "维修扣除" },
        201,
      );
      const ex = (
        await finance.call("GET", "/expenses?orderId=" + order.id)
      ).items.find((x) => x.feeType === "DEPOSIT_REFUND");
      assert(ex);
      await finance.call(
        "POST",
        "/expenses/" + ex.id + "/pay",
        {
          paidOn: "2027-08-31",
          fundAccountId: account.id,
          paymentMethod: "BANK",
        },
        201,
      );
      await finance.call(
        "POST",
        "/orders/" + order.id + "/deposit-settlement",
        { deductionAmount: "100", reason: "重复" },
        400,
      );
    },
  );
  await t.test(
    "optimistic changes append inline history and soft deletion retains it",
    async () => {
      let p = await admin.call(
        "POST",
        "/projects",
        {
          name: "测试项目-" + randomUUID().slice(0, 5),
          typeConfigs: [{ code: "LARGE", name: "大单位", building: "A座", floor: "12", area: "38", layout: "1室1厅", age: 3, minRent: "1000", maxRent: "20000" }],
          region: "九龙",
          address: "测试地址",
          propertyName: "测试物业",
          longitude: 114.1694,
          latitude: 22.3193,
          extra: {
            developmentDate: "2020-01-01",
            salesStatus: "现售",
            usage: "住宅",
            areaRange: "30-60 ㎡",
          },
        },
        201,
      );
      assert.equal(p.propertyName, "测试物业");
      assert.equal(p.extra.developmentDate, "2020-01-01");
      assert.equal(p.extra.areaRange, "30-60 ㎡");
      const revised = await admin.call("PATCH", "/projects/" + p.id, {
        revision: p.revision,
        name: p.name + " 修改",
      });
      await admin.call(
        "PATCH",
        "/projects/" + p.id,
        { revision: p.revision, name: "覆盖" },
        409,
      );
      const history = await admin.call(
        "GET",
        "/projects/" + p.id + "/operations",
      );
      assert.equal(history.length, 2);
      assert.equal(history[1].changes.name.after, revised.name);
      const detail = await admin.call("GET", "/projects/" + p.id);
      assert.deepEqual(detail.operations, history);
      await admin.call("DELETE", "/projects/" + p.id, { reason: "测试完成" });
      await admin.call("GET", "/projects/" + p.id, undefined, 404);
    },
  );
  await t.test(
    "overlapping orders and repeated periodic generation are rejected",
    async () => {
      const pending = (await admin.call("GET", "/orders?status=PENDING"))
        .items[0];
      await admin.call(
        "POST",
        "/orders",
        {
          unitId: pending.unitId,
          salesUserId: pending.salesUserId,
          tenantType: "PERSON",
          tenantName: "重复租赁",
          startsOn: "2026-10-01",
          endsOn: "2027-09-30",
          monthlyRent: "5800",
          depositAmount: "11600",
          commission: { mode: "ONE_TIME", dueOn: "2026-10-10", amount: "200" },
        },
        409,
      );
      await finance.call("POST", "/jobs/run", {}, 201);
      const before = (await admin.call("GET", "/incomes")).total;
      await finance.call("POST", "/jobs/run", {}, 201);
      assert.equal((await admin.call("GET", "/incomes")).total, before);
    },
  );
  await t.test(
    "project code stays fixed and logo editing honors the four-image limit",
    async () => {
      const project = await admin.call(
        "POST",
        "/projects",
        {
          name: "Logo 编辑测试-" + randomUUID().slice(0, 5),
          typeConfigs: [{ code: "LARGE", name: "大单位", building: "A座", floor: "12", area: "38", layout: "1室1厅", age: 3, minRent: "1000", maxRent: "20000" }],
          region: "港岛",
          address: "测试地址",
          longitude: 114.1694,
        },
        201,
      );
      await admin.call(
        "PATCH",
        `/projects/${project.id}`,
        { revision: project.revision, code: "CHANGED" },
        400,
      );
      const edited = await admin.call("PATCH", `/projects/${project.id}`, {
        revision: project.revision,
        longitude: null,
      });
      assert.equal(edited.code, project.code);
      assert.equal(edited.completionDate, null);
      assert.equal(edited.longitude, null);

      async function uploadLogo(index: number, expected = 201) {
        const body = new FormData();
        body.append(
          "payload",
          JSON.stringify({
            projectId: project.id,
            category: "LOGO",
            title: `logo-${index}.png`,
            sortOrder: index,
          }),
        );
        body.append(
          "file",
          new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])], {
            type: "image/png",
          }),
          `logo-${index}.png`,
        );
        const response = await fetch(base + "/materials/upload", {
          method: "POST",
          headers: { Cookie: admin.cookies, "X-CSRF-Token": admin.csrf },
          body,
        });
        const data = await response.json();
        assert.equal(response.status, expected, JSON.stringify(data));
        return data;
      }

      const logos = [];
      for (let index = 0; index < 4; index++)
        logos.push(await uploadLogo(index));
      await uploadLogo(4, 400);
      const ids = logos.map((logo) => logo.id).reverse();
      await admin.call("PATCH", `/projects/${project.id}/logos/order`, { ids });
      const materials = await admin.call(
        "GET",
        `/materials?projectId=${project.id}&category=LOGO`,
      );
      assert.equal(
        materials.items.find((item: any) => item.id === ids[0]).sortOrder,
        0,
      );
      const detail = await admin.call("GET", `/projects/${project.id}`);
      assert.equal(detail.materials.length, 4);
      assert.equal(detail.materials[0].id, ids[0]);
      assert.equal(
        detail.materials[0].downloadUrl,
        `/api/v1/materials/${ids[0]}/download`,
      );
      const internalFile = await admin.call("POST", "/materials", {
        projectId: project.id,
        category: "PROJECT_FILE",
        title: "内部资料",
        body: "仅内部可见",
        visibility: "INTERNAL",
      }, 201);
      assert((await admin.call("GET", `/projects/${project.id}`)).materials.some(
        (item: any) => item.id === internalFile.id,
      ));
      assert(!(await sales.call("GET", `/projects/${project.id}`)).materials.some(
        (item: any) => item.id === internalFile.id,
      ));
      assert.equal((await admin.call("GET", "/projects")).items.find(
        (item: any) => item.id === project.id,
      ).materials, undefined);
      await admin.call("DELETE", `/materials/${ids[0]}`, {
        reason: "移除旧 Logo",
      });
      await uploadLogo(5);
    },
  );
  await t.test(
    "project unit cards can filter and sort by reference rent",
    async () => {
      const units = await admin.call("GET", "/units?pageSize=100");
      assert(units.items.length >= 2);
      const low = await admin.call(
        "GET",
        "/units?pageSize=100&sortBy=referenceRent&sort=asc",
      );
      const high = await admin.call(
        "GET",
        "/units?pageSize=100&sortBy=referenceRent&sort=desc",
      );
      assert.deepEqual(
        low.items.map((item: any) => Number(item.referenceRent)),
        [...low.items]
          .map((item: any) => Number(item.referenceRent))
          .sort((a, b) => a - b),
      );
      assert.deepEqual(
        high.items.map((item: any) => Number(item.referenceRent)),
        [...high.items]
          .map((item: any) => Number(item.referenceRent))
          .sort((a, b) => b - a),
      );
      const selected = units.items[0];
      const photo = new FormData();
      photo.append(
        "payload",
        JSON.stringify({
          unitId: selected.id,
          category: "PHOTO",
          title: "单位首图.png",
          visibility: "SHARED",
        }),
      );
      photo.append(
        "file",
        new Blob([Buffer.from([0x89, 0x50, 0x4e, 0x47, 13, 10, 26, 10])], {
          type: "image/png",
        }),
        "单位首图.png",
      );
      const photoResponse = await fetch(base + "/materials/upload", {
        method: "POST",
        headers: { Cookie: admin.cookies, "X-CSRF-Token": admin.csrf },
        body: photo,
      });
      assert.equal(photoResponse.status, 201);
      const uploadedPhoto = await photoResponse.json();
      const refreshed = await admin.call("GET", `/units/${selected.id}`);
      assert.equal(
        refreshed.coverUrl,
        `/api/v1/materials/${uploadedPhoto.id}/download`,
      );
      assert.equal(refreshed.materials.find((item: any) => item.id === uploadedPhoto.id).downloadUrl,
        refreshed.coverUrl);
      assert.equal(refreshed.materials.find((item: any) => item.id === uploadedPhoto.id).originalName,
        "单位首图.png");
      const withCover = await admin.call("GET", "/units?pageSize=100");
      assert.equal(
        withCover.items.find((item: any) => item.id === selected.id).coverUrl,
        refreshed.coverUrl,
      );
      const selectedRent = Number(selected.referenceRent);
      const exact = await admin.call(
        "GET",
        `/units?projectId=${selected.projectId}&rentMin=${selectedRent}&rentMax=${selectedRent}`,
      );
      assert(exact.items.some((item: any) => item.id === selected.id));
      assert(
        exact.items.every(
          (item: any) => Number(item.referenceRent) === selectedRent,
        ),
      );
      await admin.call("GET", "/units?rentMin=100&rentMax=50", undefined, 400);
      const hidden = (
        await sales.call("GET", "/units?pageSize=100")
      ).items.find((item: any) => item.referenceRent === undefined);
      assert(hidden);
      await sales.call(
        "GET",
        `/units?projectId=${hidden.projectId}&rentMin=100`,
        undefined,
        400,
      );
    },
  );
  await t.test("unit creation validates the reference rent range", async () => {
    const existing = await admin.call("GET", `/units/${order.unitId}`);
    const body = {
      projectId: existing.projectId,
      roomNo: `价格校验-${randomUUID().slice(0, 8)}`,
      unitTypeCode: existing.unitTypeCode,
      area: "38",
      referenceRent: "899",
      minRent: "12122",
      maxRent: "33434",
      minLeaseMonths: 12,
      extra: {
        phase: "A座",
        currentState: "可租",
        usage: "住宅",
        rentCycle: "月付",
      },
    };
    const rejected = await admin.call("POST", "/units", body, 400);
    assert.equal(rejected.message, "月租价格须介于单位类型的最低价和最高价之间");
    const created = await admin.call(
      "POST",
      "/units",
      { ...body, referenceRent: "22222" },
      201,
    );
    assert.equal(created.extra.phase, "A座");
    assert.equal(Number(created.minRent), 900);
    assert.equal(Number(created.maxRent), 35000);
    assert.equal(created.floor, "12");
    await admin.call("DELETE", `/units/${created.id}`, {
      reason: "价格校验测试完成",
    });
  });
  await t.test("new order keeps tenant and initial-payment details", async () => {
    const existing = await admin.call("GET", `/units/${order.unitId}`);
    const unit = await admin.call(
      "POST",
      "/units",
      {
        projectId: existing.projectId,
        roomNo: `新订单-${randomUUID().slice(0, 8)}`,
        unitTypeCode: existing.unitTypeCode,
        area: "38",
        referenceRent: "5800",
        minRent: "5000",
        maxRent: "6500",
        minLeaseMonths: 12,
      },
      201,
    );
    const body = {
      unitId: unit.id,
      salesUserId: order.salesUserId,
      tenantType: "COMPANY",
      tenantName: "示例租客公司",
      registrationNoType: "BR",
      tenantRegistrationNo: "BR-12345",
      startsOn: "2026-11-01",
      endsOn: "2027-10-31",
      monthlyRent: "5800",
      depositAmount: "11600",
      depositPlan: "TWO_ONE",
      commission: {
        mode: "ONE_TIME",
        dueOn: "2026-11-05",
        amount: "200",
        remark: "首月佣金",
      },
      moveInOn: "2026-11-01",
      initialPayment: {
        paymentState: "PARTIAL",
        paid: true,
        rentPaid: true,
        depositPaid: false,
        rentReceived: "5800",
        depositReceived: "0",
        dueOn: "2026-10-28",
        receivedOn: "2026-10-28",
        fundAccountId: account.id,
        paymentMethod: "BANK",
      },
    };
    await admin.call("POST", "/orders", {
      ...body,
      initialPayment: { ...body.initialPayment, paid: false },
    }, 400);
    await admin.call("POST", "/orders", {
      ...body,
      registrationNoType: "HKID",
    }, 400);
    await admin.call("POST", "/orders", {
      ...body,
      commission: { ...body.commission, amount: "-1" },
    }, 400);
    const created = await admin.call("POST", "/orders", body, 201);
    assert.ok(created.currentContractMaterialId);
    assert.equal(created.contractGenerationPending, false);
    const ensured = await sales.call(
      "POST",
      `/orders/${created.id}/contract/ensure`,
      undefined,
      201,
    );
    assert.equal(ensured.id, created.currentContractMaterialId);
    const contract = await fetch(
      base + `/orders/${created.id}/contract/download`,
      { headers: { Cookie: sales.cookies } },
    );
    assert.equal(contract.status, 200);
    assert.match(contract.headers.get("content-disposition") ?? "", /^attachment;/);
    assert.equal(Buffer.from(await contract.arrayBuffer()).subarray(0, 4).toString(), "%PDF");
    await other.call("POST", `/orders/${created.id}/contract/ensure`, undefined, 404);
    let detail = await admin.call("GET", `/orders/${created.id}`);
    assert.equal(detail.actions.editLease,false);
    assert.equal(detail.occupancyState,"OCCUPIED");
    const initialReceipts=detail.bills.flatMap((b:any)=>b.receipts);
    assert.equal(initialReceipts.length,1);
    for(const r of initialReceipts) await finance.call("POST",`/incomes/${r.id}/reverse`,{reason:"金额需重新登记"},201);
    detail=await admin.call("GET",`/orders/${created.id}`);
    assert.equal(detail.actions.editLease,true);
    assert.equal(detail.actions.close,true);
    assert.equal(detail.registrationNoType, "BR");
    assert.equal(detail.depositPlan, "TWO_ONE");
    assert.equal(detail.moveInOn.slice(0, 10), "2026-11-01");
    assert.equal(detail.initialPayment.rentReceived, "5800");
    assert.equal(detail.initialPayment.paymentState, "PARTIAL");
    assert.equal(Number(detail.orderCommission.amount), 200);
    assert.equal(detail.orderCommission.mode, "ONE_TIME");
    assert.equal(detail.orderCommission.periodStart.slice(0, 10), "2026-11-01");
    assert.equal(detail.orderCommission.periodEnd.slice(0, 10), "2027-10-31");
    assert.equal(detail.orderCommission.dueOn.slice(0, 10), "2026-11-05");
    assert.equal(detail.commissions.length, 1);
    assert.equal(detail.status, "PENDING");
    const edited = await admin.call("PATCH", `/orders/${created.id}`, {
      revision: detail.revision,
      reason: "核对租客资料",
      tenantType: "PERSON",
      tenantName: "新租客",
      tenantPhone: "12345678",
      tenantEmail: "new-tenant@example.com",
      registrationNoType: null,
      tenantRegistrationNo: "",
      tenantContactName: "",
      depositPlan: null,
      moveInOn: null,
      initialPayment: {
        paymentState: "PAID",
        paid: true,
        rentPaid: true,
        depositPaid: true,
        rentReceived: "5800",
        depositReceived: "11600",
        dueOn: "2026-10-28",
        receivedOn: "2026-10-28",
        fundAccountId: account.id,
        paymentMethod: "BANK",
      },
      commission: { ...body.commission, amount: "250" },
    });
    assert.equal(edited.tenantType, "PERSON");
    assert.equal(edited.tenantName, "新租客");
    assert.equal(edited.registrationNoType, null);
    assert.equal(edited.tenantRegistrationNo, "");
    assert.equal(edited.depositPlan, null);
    assert.equal(edited.moveInOn, null);
    assert.equal(edited.initialPayment.paymentState, "PAID");
    assert.equal(edited.initialPayment.depositReceived, "11600");
    assert.equal(Number(edited.orderCommission.amount), 250);
    assert.equal(edited.orderCommission.id, detail.orderCommission.id);
    assert.deepEqual(edited.tenantSnapshot, {
      name: "新租客",
      phone: "12345678",
      email: "new-tenant@example.com",
    });
    const updatedContract = await operations.call(
      "POST",
      `/orders/${created.id}/contract/ensure`,
      undefined,
      201,
    );
    assert.notEqual(updatedContract.id, created.currentContractMaterialId);
    const refreshed = await admin.call("GET", `/orders/${created.id}`);
    assert.equal(refreshed.currentContractMaterialId, updatedContract.id);
  });
  await t.test("monthly commission creates installments and edits with the lease", async () => {
    const template = await admin.call("GET", `/units/${order.unitId}`);
    const unit = await admin.call(
      "POST",
      "/units",
      {
        projectId: template.projectId,
        roomNo: `月结佣金-${randomUUID().slice(0, 8)}`,
        unitTypeCode: template.unitTypeCode,
        area: "38",
        referenceRent: "5800",
        minRent: "5000",
        maxRent: "6500",
        minLeaseMonths: 1,
      },
      201,
    );
    let created = await admin.call("POST", "/orders", {
      unitId: unit.id,
      salesUserId: order.salesUserId,
      tenantType: "PERSON",
      tenantName: "月结租客",
      startsOn: "2026-11-01",
      endsOn: "2027-01-31",
      monthlyRent: "5800",
      depositAmount: "5800",
      depositPlan: "ONE_ONE",
      commission: {
        mode: "RECURRING_MONTHLY",
        dueOn: "2026-11-05",
        amount: "100",
      },
    }, 201);
    let detail = await admin.call("GET", `/orders/${created.id}`);
    let installments = detail.commissions.filter((c: any) => c.status !== "VOID");
    assert.equal(installments.length, 3);
    assert.deepEqual(installments.map((c: any) => c.dueOn.slice(0, 10)), [
      "2026-11-05", "2026-12-05", "2027-01-05",
    ]);
    assert(installments.every((c: any) => c.mode === "RECURRING_MONTHLY" && Number(c.amount) === 100));
    created = await admin.call("PATCH", `/orders/${created.id}`, {
      revision: detail.revision,
      reason: "延长租期",
      endsOn: "2027-02-28",
      commission: {
        mode: "RECURRING_MONTHLY",
        dueOn: "2026-11-05",
        amount: "100",
      },
    });
    detail = await admin.call("GET", `/orders/${created.id}`);
    installments = detail.commissions.filter((c: any) => c.status !== "VOID");
    assert.equal(installments.length, 4);
    assert.equal(installments[3].dueOn.slice(0, 10), "2027-02-05");
    await admin.call("PATCH", `/orders/${created.id}`, {
      revision: detail.revision,
      reason: "改为一次性结付",
      commission: { mode: "ONE_TIME", dueOn: "2026-12-01", amount: "400" },
    });
    detail = await admin.call("GET", `/orders/${created.id}`);
    installments = detail.commissions.filter((c: any) => c.status !== "VOID");
    assert.equal(installments.length, 1);
    assert.equal(installments[0].mode, "ONE_TIME");
    assert.equal(installments[0].periodEnd.slice(0, 10), "2027-02-28");
    assert.equal(installments[0].dueOn.slice(0, 10), "2026-12-01");
    const archivedIds = detail.commissions.filter((c: any) => c.status === "VOID").map((c: any) => c.id);
    await admin.call("PATCH", `/orders/${created.id}`, {
      revision: detail.revision,
      reason: "恢复月结但保留历史",
      commission: { mode: "RECURRING_MONTHLY", dueOn: "2026-11-05", amount: "100" },
    });
    detail = await admin.call("GET", `/orders/${created.id}`);
    installments = detail.commissions.filter((c: any) => c.status !== "VOID");
    assert.equal(installments.length, 4);
    assert(installments.every((c: any) => !archivedIds.includes(c.id)));
    assert(archivedIds.every((id: string) => detail.commissions.some((c: any) => c.id === id && c.status === "VOID")));
  });
  await t.test(
    "material versions keep one current record and retain private ownership",
    async () => {
      const first = await admin.call(
        "POST",
        "/materials",
        {
          orderId: order.id,
          category: "OTHER",
          title: "版本测试",
          body: "初稿",
          visibility: "INTERNAL",
        },
        201,
      );
      const next = await admin.call(
        "POST",
        `/materials/${first.id}/versions`,
        { payload: JSON.stringify({ body: "第二版" }) },
        201,
      );
      assert.equal(next.versionNo, 2);
      assert.equal(next.orderId, order.id);
      assert.equal(next.materialGroupId, first.materialGroupId);
      const history = await admin.call("GET", `/materials/${next.id}/versions`);
      assert.equal(history.total, 2);
      assert.equal(history.items.filter((m: any) => m.isCurrent).length, 1);
      await sales.call("GET", `/materials/${next.id}`, undefined, 404);

      const upload = new FormData();
      upload.append(
        "payload",
        JSON.stringify({
          orderId: order.id,
          category: "OTHER",
          title: "文件版本",
        }),
      );
      upload.append(
        "file",
        new Blob(["%PDF-1.4\n%%EOF"], { type: "application/pdf" }),
        "租赁资料.pdf",
      );
      const uploadedResponse = await fetch(base + "/materials/upload", {
        method: "POST",
        headers: { Cookie: admin.cookies, "X-CSRF-Token": admin.csrf },
        body: upload,
      });
      assert.equal(uploadedResponse.status, 201);
      const uploaded = await uploadedResponse.json();
      const revisedFile = await admin.call(
        "POST",
        `/materials/${uploaded.id}/versions`,
        { payload: JSON.stringify({ title: "文件版本修改" }) },
        201,
      );
      assert.equal(revisedFile.storageKey, uploaded.storageKey);
      assert.equal(revisedFile.originalName, "租赁资料.pdf");
      assert.equal(revisedFile.title, "文件版本修改");
      const download = await fetch(
        base + `/materials/${revisedFile.id}/download`,
        {
          headers: { Cookie: admin.cookies },
        },
      );
      assert.equal(download.status, 200);
      assert.match(
        download.headers.get("content-disposition") ?? "",
        /inline; filename\*=UTF-8''%E7%A7%9F%E8%B5%81%E8%B5%84%E6%96%99\.pdf/,
      );
      assert.equal((await download.text()).slice(0, 4), "%PDF");
      const attachment = await fetch(
        base + `/materials/${revisedFile.id}/download?download=1`,
        { headers: { Cookie: admin.cookies } },
      );
      assert.equal(attachment.status, 200);
      assert.match(
        attachment.headers.get("content-disposition") ?? "",
        /^attachment; filename\*=/,
      );
    },
  );
  await t.test(
    "protected file streams support seeking, HEAD and strict size limits",
    async () => {
      const bytes = Buffer.concat([
        Buffer.from([0, 0, 0, 24]),
        Buffer.from("ftypmp42"),
        Buffer.alloc(2048, 42),
      ]);
      const unit = await admin.call("GET", `/units/${order.unitId}`);
      const body = new FormData();
      body.append(
        "payload",
        JSON.stringify({
          unitId: unit.id,
          category: "VIDEO",
          title: "seek-test.mp4",
          visibility: "INTERNAL",
        }),
      );
      body.append(
        "file",
        new Blob([bytes], { type: "video/mp4" }),
        "seek-test.mp4",
      );
      const uploaded = await fetch(base + "/materials/upload", {
        method: "POST",
        headers: { Cookie: admin.cookies, "X-CSRF-Token": admin.csrf },
        body,
      });
      assert.equal(uploaded.status, 201);
      const file = await uploaded.json();
      assert.equal(file.storageProvider, "LOCAL");
      const path = `/materials/${file.id}/download`;
      const partial = await fetch(base + path, {
        headers: { Cookie: admin.cookies, Range: "bytes=4-11" },
      });
      assert.equal(partial.status, 206);
      assert.equal(
        partial.headers.get("content-range"),
        `bytes 4-11/${bytes.length}`,
      );
      assert.equal(partial.headers.get("content-length"), "8");
      assert.equal(await partial.text(), "ftypmp42");
      const suffix = await fetch(base + path, {
        headers: { Cookie: admin.cookies, Range: "bytes=-8" },
      });
      assert.equal(suffix.status, 206);
      assert.deepEqual(
        Buffer.from(await suffix.arrayBuffer()),
        bytes.subarray(-8),
      );
      const invalid = await fetch(base + path, {
        headers: { Cookie: admin.cookies, Range: "bytes=999999-" },
      });
      assert.equal(invalid.status, 416);
      assert.equal(
        invalid.headers.get("content-range"),
        `bytes */${bytes.length}`,
      );
      const head = await fetch(base + path, {
        method: "HEAD",
        headers: { Cookie: admin.cookies },
      });
      assert.equal(head.status, 200);
      assert.equal(head.headers.get("content-length"), String(bytes.length));
      assert.equal((await head.arrayBuffer()).byteLength, 0);
      await sales.call("GET", path, undefined, 404);
      assert.equal((await fetch(base + path)).status, 401);
      const version = await admin.call(
        "POST",
        `/materials/${file.id}/versions`,
        { payload: JSON.stringify({ title: "metadata-only" }) },
        201,
      );
      assert.equal(version.storageProvider, file.storageProvider);
      assert.equal(version.storageKey, file.storageKey);
      await admin.call("DELETE", `/materials/${file.id}`, {
        reason: "retain history bytes",
      });
      const historyDownload = await fetch(
        base + `/materials/${version.id}/download`,
        { headers: { Cookie: admin.cookies } },
      );
      assert.equal(historyDownload.status, 200);
      assert.deepEqual(Buffer.from(await historyDownload.arrayBuffer()), bytes);
      const tooLarge = new FormData();
      tooLarge.append(
        "file",
        new Blob([Buffer.alloc(2 * 1024 * 1024 + 1)], { type: "image/png" }),
        "too-large.png",
      );
      const rejected = await fetch(base + `/users/${a.id}/avatar`, {
        method: "POST",
        headers: { Cookie: admin.cookies, "X-CSRF-Token": admin.csrf },
        body: tooLarge,
      });
      assert.equal(rejected.status, 413);
    },
  );
});

test("order detail, bill synchronization and deposit lifecycle", async (t) => {
  // Fresh authentication keeps these cases independent of the account tests above.
  await admin.login("admin");
  await finance.login("finance");
  await sales.login("sales");
  const template = await admin.call("GET", `/units/${order.unitId}`);
  async function create(depositAmount = "1200") {
    const unit = await admin.call(
      "POST",
      "/units",
      {
        projectId: template.projectId,
        roomNo: `押金流程-${randomUUID().slice(0, 8)}`,
        unitTypeCode: template.unitTypeCode,
        area: "38",
        referenceRent: "1000",
        minRent: "900",
        maxRent: "1500",
        minLeaseMonths: 1,
      },
      201,
    );
    return admin.call(
      "POST",
      "/orders",
      {
        unitId: unit.id,
        salesUserId: order.salesUserId,
        tenantType: "PERSON",
        tenantName: "结算租客",
        startsOn: "2026-11-01",
        endsOn: "2026-11-30",
        monthlyRent: "1000",
        depositAmount,
        depositPlan: "OTHER",
        commission: { mode: "ONE_TIME", dueOn: "2026-11-10", amount: "100" },
      },
      201,
    );
  }
  async function detail(id: string) {
    return admin.call("GET", `/orders/${id}`);
  }
  async function receive(bill: any, amount: string) {
    const r = await operations.call(
      "POST",
      `/incomes/${bill.id}/receipts`,
      {
        amount,
        receivedOn: "2026-11-01",
        fundAccountId: account.id,
        paymentMethod: "BANK",
        payerName: "结算租客",
        sourceKey: randomUUID(),
      },
      201,
    );
    await finance.call("POST", `/incomes/${r.id}/confirm`, undefined, 201);
    return r;
  }
  async function end(id: string, date = "2026-11-30") {
    await admin.call(
      "POST",
      `/orders/${id}/terminate`,
      { date, reason: "退租核算" },
      201,
    );
    await admin.call(
      "POST",
      `/orders/${id}/handover`,
      { date, note: "已交还钥匙" },
      201,
    );
  }
  await t.test(
    "rent edits preserve deposit bills; offsets and partial refunds keep one ledger",
    async () => {
      let o = await create();
      const oldContract = o.currentContractMaterialId;
      const originalDeposit = o.bills.find((b: any) => b.feeType === "DEPOSIT");
      o = await admin.call("PATCH", `/orders/${o.id}`, {
        revision: o.revision,
        reason: "租金核对",
        monthlyRent: "1100",
      });
      assert.notEqual(o.currentContractMaterialId, oldContract);
      const active = o.bills.filter((b: any) => b.status !== "VOID");
      assert.equal(active.length, 2);
      const voided = o.bills.filter((b: any) => b.status === "VOID");
      assert.equal(voided.length, 1);
      assert.equal(voided[0].feeType, "RENT");
      const preservedDeposit = active.find((b: any) => b.feeType === "DEPOSIT");
      assert.equal(preservedDeposit.id, originalDeposit.id);
      assert.equal(preservedDeposit.revision, originalDeposit.revision);
      assert.equal(
        Number(active.find((b: any) => b.feeType === "RENT").total),
        1100,
      );
      assert.equal(o.actions.edit, true);
      for (const b of active) await receive(b, b.total);
      o = await detail(o.id);
      assert.equal(o.status, "ACTIVE");
      assert.equal(o.firstPaymentStatus, "PAID");
      assert.equal(o.deposit.state, "HELD");
      assert.equal(o.actions.edit, true);
      assert.equal(o.actions.editLease, false);
      o = await admin.call("PATCH", `/orders/${o.id}`, {
        revision: o.revision,
        reason: "更新租客联系方式",
        tenantPhone: "98765432",
      });
      assert.equal(o.tenantPhone, "98765432");
      assert.equal(o.tenantSnapshot.phone, "98765432");
      await admin.call(
        "PATCH",
        `/orders/${o.id}`,
        { revision: o.revision, reason: "禁止已收款修改", monthlyRent: "1000" },
        400,
      );
      await admin.call("POST", `/orders/${o.id}/close`, undefined, 400);
      const bill = await admin.call(
        "POST",
        `/orders/${o.id}/fees`,
        {
          amount: "900",
          dueOn: "2026-11-15",
          remark: "水电费用",
          sourceKey: crypto.randomUUID(),
        },
        201,
      );
      await finance.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        { deductionAmount: "0", reason: "未交还" },
        400,
      );
      await end(o.id, "2026-11-15");
      o = await detail(o.id);
      assert.equal(o.deposit.state, "SETTLEMENT_PENDING");
      assert.equal(o.rentRefunds.length, 1);
      assert.equal(Number(o.rentRefunds[0].amount), 550);
      const settlement = {
        deductionAmount: "300",
        reason: "抵扣水电欠费",
        items: [
          {
            label: "水电费",
            amount: "300",
            note: "账单抵扣",
            incomeId: bill.id,
          },
        ],
      };
      await sales.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        settlement,
        403,
      );
      await finance.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        { ...settlement, deductionAmount: "400" },
        400,
      );
      await finance.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        settlement,
        201,
      );
      // Identical retries must not create another refund or another offset.
      await finance.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        settlement,
        201,
      );
      o = await detail(o.id);
      assert.equal(o.deposit.refunds.length, 1);
      assert.equal(Number(o.deposit.refundDue), 900);
      assert.equal(
        Number(o.bills.find((b: any) => b.id === bill.id).remaining),
        600,
      );
      assert.equal(
        Number((await finance.call("GET", `/incomes/${bill.id}`)).remaining),
        600,
      );
      const salesDetail = await sales.call("GET", `/orders/${o.id}`);
      assert.equal(salesDetail.deposit.refunds.length, 0);
      assert.equal(salesDetail.rentRefunds.length, 0);
      assert.equal(salesDetail.actions.refund, false);
      const refund = o.deposit.refunds[0];
      const pay = {
        amount: "400",
        sourceKey: randomUUID(),
        paidOn: "2026-11-16",
        fundAccountId: account.id,
        paymentMethod: "BANK",
      };
      await finance.call("POST", `/expenses/${refund.id}/pay`, pay, 201);
      await finance.call("POST", `/expenses/${refund.id}/pay`, pay, 201);
      o = await detail(o.id);
      assert.equal(Number(o.deposit.refunded), 400);
      assert.equal(Number(o.deposit.refundDue), 500);
      assert.equal(o.deposit.refunds[0].paymentRecords.length, 1);
      await finance.call(
        "POST",
        `/expenses/${refund.id}/pay`,
        { ...pay, sourceKey: randomUUID(), amount: "501" },
        400,
      );
      await finance.call(
        "POST",
        `/expenses/${refund.id}/pay`,
        { ...pay, sourceKey: randomUUID(), amount: "500" },
        201,
      );
      o = await detail(o.id);
      assert.equal(o.deposit.state, "SETTLED");
      assert.equal(Number(o.deposit.held), 0);
      assert.equal(o.deposit.refunds[0].status, "PAID");
      assert.equal(o.deposit.refunds[0].paymentRecords.length, 2);
      assert.ok(o.operations.some((x: any) => x.reason === "抵扣水电欠费"));
      const commission = o.commissions.find((c: any) => c.status !== "VOID");
      assert.ok(commission);
      await finance.call(
        "POST",
        `/commissions/${commission.id}/payments`,
        {
          amount: "100",
          sourceKey: randomUUID(),
          paidOn: "2026-12-01",
          fundAccountId: account.id,
          paymentMethod: "BANK",
        },
        201,
      );
      const paidCommission = (await detail(o.id)).commissions.find(
        (c: any) => c.id === commission.id,
      );
      assert.equal(paidCommission.status, "PAID");
      assert.equal(Number(paidCommission.remainingAmount), 0);
      assert.equal(Number(paidCommission.availableAmount), 0);

      assert.ok(
        o.materials.some((x: any) => x.id === o.currentContractMaterialId),
      );
    },
  );
  await t.test(
    "zero deposit activation ignores voided old deposit; no refund expense",
    async () => {
      let o = await create("500");
      o = await admin.call("PATCH", `/orders/${o.id}`, {
        revision: o.revision,
        reason: "免押金",
        depositAmount: "0",
      });
      const rent = o.bills.find(
        (b: any) => b.feeType === "RENT" && b.status !== "VOID",
      );
      await receive(rent, rent.total);
      o = await detail(o.id);
      assert.equal(o.status, "ACTIVE");
      await end(o.id);
      await finance.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        { deductionAmount: "0", reason: "无押金无需退款", items: [] },
        201,
      );
      o = await detail(o.id);
      assert.equal(o.deposit.state, "SETTLED");
      assert.equal(o.deposit.refunds.length, 0);
    },
  );
  await t.test(
    "full deposit deduction creates no refund and cannot change settled amount",
    async () => {
      let o = await create("500");
      o = await detail(o.id);
      for (const b of o.bills) await receive(b, b.total);
      await end(o.id);
      await finance.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        { deductionAmount: "501", reason: "超额扣除" },
        400,
      );
      await finance.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        {
          deductionAmount: "500",
          reason: "维修扣除",
          items: [{ label: "维修", amount: "500", note: "门锁更换" }],
        },
        201,
      );
      o = await detail(o.id);
      assert.equal(o.deposit.refunds.length, 0);
      assert.equal(Number(o.deposit.held), 0);
      assert.equal(o.deposit.state, "SETTLED");
      const deposit = o.bills.find((b: any) => b.feeType === "DEPOSIT");
      await finance.call(
        "POST",
        `/incomes/${deposit.id}/adjust`,
        { amount: "600", reason: "不可变更押金", revision: deposit.revision },
        404,
      );
      await finance.call(
        "POST",
        `/orders/${o.id}/deposit-settlement`,
        { deductionAmount: "400", reason: "不可重复结算" },
        400,
      );
    },
  );
});
