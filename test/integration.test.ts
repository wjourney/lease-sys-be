import { test, before } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
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
        username: "escalate",
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
      const username = `member_${randomUUID().slice(0, 8)}`;
      const created = await admin.call(
        "POST",
        "/users",
        {
          username,
          name: "测试成员",
          phone: "13800000000",
          role: "OPERATIONS",
          status: "ACTIVE",
        },
        201,
      );
      assert.equal(created.username, username);
      assert.ok(created.initialPassword?.length >= 10);
      const member = new Client();
      await member.login(username, created.initialPassword);
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
        headers: { Cookie: member.cookies, "X-CSRF-Token": member.csrf },
        body: otherAvatar,
      });
      assert.equal(forbiddenUpload.status, 403);
      assert.equal(
        (await admin.call("GET", `/users/${created.id}`)).avatarUrl,
        `/api/v1/users/${created.id}/avatar`,
      );
      const avatarImage = await fetch(base + `/users/${created.id}/avatar`, {
        headers: { Cookie: member.cookies },
      });
      assert.equal(avatarImage.status, 200);
      assert.equal(avatarImage.headers.get("content-type"), "image/png");
      const reset = await admin.call(
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
      const secondAdmin = await admin.call(
        "POST",
        "/users",
        {
          username: `admin_${randomUUID().slice(0, 8)}`,
          name: "第二位管理员",
          phone: "13800009999",
          role: "SUPER_ADMIN",
          status: "ACTIVE",
        },
        201,
      );
      await admin.call(
        "POST",
        `/users/${secondAdmin.id}/disable`,
        { reason: "管理员账号受保护" },
        403,
      );
      await admin.call(
        "PATCH",
        `/users/${secondAdmin.id}`,
        {
          revision: secondAdmin.revision,
          status: "DISABLED",
          reason: "管理员账号受保护",
        },
        403,
      );
      assert.equal(
        (await admin.call("GET", `/users/${secondAdmin.id}`)).status,
        "ACTIVE",
      );
      const activeMember = await admin.call("GET", `/users/${created.id}`);
      await admin.call(
        "PATCH",
        `/users/${created.id}`,
        {
          revision: activeMember.revision,
          role: "SUPER_ADMIN",
          status: "DISABLED",
          reason: "不能同时改角色与停用",
        },
        403,
      );
      const disabled = await admin.call(
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
    const token = sales.csrf;
    sales.csrf = "invalid";
    await sales.call("POST", "/incomes/" + root.id + "/receipts", {}, 403);
    sales.csrf = token;
  });
  await t.test(
    "receipt pending reserves balance and duplicate key is idempotent",
    async () => {
      const body = {
        amount: "1000",
        receivedOn: "2026-09-29",
        fundAccountId: account.id,
        paymentMethod: "BANK",
        payerName: order.tenantName,
        sourceKey: randomUUID(),
      };
      receipt = await sales.call(
        "POST",
        "/incomes/" + root.id + "/receipts",
        body,
        201,
      );
      const same = await sales.call(
        "POST",
        "/incomes/" + root.id + "/receipts",
        body,
        201,
      );
      assert.equal(same.id, receipt.id);
      const detail = await sales.call("GET", "/incomes/" + root.id);
      assert.equal(Number(detail.pending), 1000);
      assert.equal(Number(detail.confirmed), 0);
      await sales.call("POST", "/incomes/" + receipt.id + "/confirm", {}, 403);
    },
  );
  await t.test("finance confirmation creates invoice once", async () => {
    await finance.call("POST", "/incomes/" + receipt.id + "/confirm", {}, 201);
    await finance.call("POST", "/incomes/" + receipt.id + "/confirm", {}, 201);
    const invs = await finance.call("GET", "/invoices?incomeId=" + receipt.id);
    assert.equal(invs.total, 1);
    invoice = invs.items[0];
    const detail = await finance.call("GET", "/incomes/" + root.id);
    assert.equal(Number(detail.confirmed), 1000);
    assert.equal(Number(detail.pending), 0);
    assert.equal(detail.status, "PARTIAL");
    await other.call("GET", "/invoices/" + invoice.id, undefined, 404);
  });
  await t.test(
    "financial records cannot be erased with generic delete or patch",
    async () => {
      await admin.call(
        "DELETE",
        "/incomes/" + receipt.id,
        { reason: "test" },
        400,
      );
      const d = await admin.call("GET", "/incomes/" + root.id);
      await admin.call(
        "PATCH",
        "/incomes/" + root.id,
        { revision: d.revision, amount: "1" },
        400,
      );
      await finance.call(
        "POST",
        "/incomes/" + root.id + "/adjust",
        { revision: d.revision, amount: "10", reason: "test" },
        400,
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
            Cookie: sales.cookies,
            "X-CSRF-Token": sales.csrf,
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
        "/incomes/" + pending.id + "/reject",
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
        const receipt = await sales.call(
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
          region: "港岛",
          address: "测试地址",
          completionDate: "2023-01-01",
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
        completionDate: null,
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
      unitNo: `价格校验-${randomUUID().slice(0, 8)}`,
      unitTypeCode: existing.unitTypeCode,
      area: "38",
      referenceRent: "2222",
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
    assert.equal(rejected.message, "参考月租须介于最低价和最高价之间");
    const created = await admin.call(
      "POST",
      "/units",
      { ...body, referenceRent: "22222" },
      201,
    );
    assert.equal(created.extra.phase, "A座");
    await admin.call("DELETE", `/units/${created.id}`, {
      reason: "价格校验测试完成",
    });
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
        "original.pdf",
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
      assert.equal(revisedFile.originalName, "original.pdf");
      assert.equal(revisedFile.title, "文件版本修改");
      const download = await fetch(
        base + `/materials/${revisedFile.id}/download`,
        {
          headers: { Cookie: admin.cookies },
        },
      );
      assert.equal(download.status, 200);
      assert.equal((await download.text()).slice(0, 4), "%PDF");
    },
  );
});
