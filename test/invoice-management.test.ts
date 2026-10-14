import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { InvoicesService } from "../src/modules/invoices/invoices.service";
import { InvoiceRenderService } from "../src/modules/invoices/invoice-render.service";
import { InvoiceQuery } from "../src/modules/invoices/invoice-query";
import { PdfService } from "../src/common/storage/pdf.service";
import { billInvoiceCounts } from "../src/modules/invoices/bill-invoice-counts";
import { ProjectsSchema } from "../src/modules/projects/dto/projects.schema";

const actor: any = { id: randomUUID(), role: "FINANCE", name: "财务" };
function fixture() {
  const bill = {
    id: randomUUID(),
    orderId: randomUUID(),
    recordNo: "B001",
    recordType: "RECEIVABLE",
    status: "OPEN",
    amount: "5000",
    adjustmentAmount: "100",
    currency: "HKD",
    payerName: "测试付款人",
    dueOn: new Date("2026-11-01"),
    periodStart: new Date("2026-10-01"),
    periodEnd: new Date("2026-10-31"),
  };
  const rows: any[] = [];
  const isolation: any[] = [];
  const order = {
    id: bill.orderId,
    status: "ACTIVE",
    tenantPhone: "12345678",
    projectId: "project",
    unitId: "unit",
    orderNo: "R001",
  };
  const db: any = {
    $queryRawUnsafe: async () => [],
    $transaction: async (fn: any, options: any) => {
      isolation.push(options);
      return fn(db);
    },
    income: {
      findMany: async ({ where }: any) => (where.parentId ? [] : [bill]),
    },
    order: { findUnique: async () => order, findMany: async () => [order] },
    project: {
      findUnique: async () => ({ id: "project", name: "海湾项目" }),
      findMany: async () => [{ id: "project", name: "海湾项目" }],
    },
    unit: {
      findUnique: async () => ({ id: "unit", unitNo: "A101" }),
      findMany: async () => [{ id: "unit", unitNo: "A101" }],
    },
    invoice: {
      findFirst: async ({ where }: any) =>
        rows.find(
          (r) =>
            (!where.id?.not || r.id !== where.id.not) &&
            where.status.in.includes(r.status),
        ),
      findUnique: async ({ where }: any) => rows.find((r) => r.id === where.id),
      create: async ({ data }: any) => {
        const r = {
          ...data,
          id: randomUUID(),
          revision: 1,
          operationLogs: [],
          deletedAt: null,
        };
        rows.push(r);
        return { ...r };
      },
      updateMany: async ({ where, data }: any) => {
        const r = rows.find(
          (r) => r.id === where.id && r.revision === where.revision,
        );
        if (!r) return { count: 0 };
        const revision = r.revision;
        Object.assign(r, data, { revision: revision + 1 });
        return { count: 1 };
      },
    },
  };
  const access: any = {
    allow: () => {},
    scope: async () => ({}),
    output: async (_a: any, _r: any, row: any) =>
      JSON.parse(JSON.stringify(row)),
    get: async (_a: any, resource: string, key: string) =>
      resource === "incomes" ? bill : rows.find((r) => r.id === key),
  };
  return {
    bill,
    rows,
    db,
    access,
    isolation,
    service: new InvoicesService(db, access),
    input: {
      billId: bill.id,
      issuedOn: "2026-10-14",
      dueOn: "2026-11-01",
      remark: "核对后出具",
    },
  };
}
test("unpaid bill can have a draft; amount and business context come from the authorized bill", async () => {
  const f = fixture();
  const draft = await f.service.create(actor, f.input);
  assert.equal(draft.status, "DRAFT");
  assert.equal(draft.incomeId, f.bill.id);
  assert.equal(String(draft.amount), "5100");
  assert.equal(draft.snapshot.projectName, "海湾项目");
  assert.equal(draft.snapshot.billNo, "B001");
  assert.equal(f.isolation[0].isolationLevel, "ReadCommitted");
  await assert.rejects(f.service.create(actor, f.input), /账单已有/);
  await assert.rejects(f.service.create(actor, { ...f.input, amount: "1" }));
});
test("draft edit and issue refresh the bill snapshot, reject stale changes and issue idempotently", async () => {
  const f = fixture();
  const draft = await f.service.create(actor, f.input);
  await assert.rejects(
    f.service.edit(actor, draft.id, {
      issuedOn: "2026-10-14",
      dueOn: "2026-11-01",
      revision: 9,
    }),
    /记录已更新/,
  );
  const edited = await f.service.edit(actor, draft.id, {
    issuedOn: "2026-10-15",
    dueOn: "2026-11-03",
    remark: "已核对",
    revision: 1,
  });
  assert.equal(edited.snapshot.remark, "已核对");
  f.bill.amount = "6000";
  const issued = await f.service.issue(actor, draft.id);
  assert.equal(issued.status, "ACTIVE");
  assert.equal(String(issued.amount), "6100");
  assert.equal((await f.service.issue(actor, draft.id)).id, draft.id);
  await assert.rejects(
    f.service.edit(actor, draft.id, {
      issuedOn: "2026-10-16",
      dueOn: "2026-11-04",
      revision: issued.revision,
    }),
    /只能编辑草稿/,
  );
  assert.equal(f.rows.length, 1);
});
test("void bills and nonfinancial roles cannot create or issue invoices", async () => {
  const f = fixture();
  for (const role of ["SALES", "SALES_COMPANY_ADMIN", "OPERATIONS"]) {
    await assert.rejects(f.service.create({ ...actor, role }, f.input));
    await assert.rejects(f.service.issue({ ...actor, role }, randomUUID()));
  }
  assert.equal(f.rows.length, 0);
  f.bill.status = "VOID";
  await assert.rejects(f.service.create(actor, f.input), /有效应收账单/);
});
test("invoice filters reject malformed dates and IDs without trusting arbitrary sort fields", () => {
  for (const q of [
    { from: "2026-02-30" },
    { from: "2026-11-02", to: "2026-11-01" },
    { billId: "invalid" },
    { sortBy: "snapshot" },
    { pageSize: 101 },
  ])
    assert.equal(InvoiceQuery.safeParse(q).success, false);
});
test("preview is a read operation for drafts, includes watermark and escapes payer content", async () => {
  let html = "";
  const inv = {
    id: randomUUID(),
    invoiceNo: "INV001",
    status: "DRAFT",
    currency: "HKD",
    amount: "5000",
    issuedOn: new Date("2026-10-14"),
    snapshot: {
      payerName: "<script>alert(1)</script>",
      dueOn: "2026-11-01",
      billNo: "B001",
    },
  };
  const pdf = new PdfService();
  const service = new InvoiceRenderService(
    {} as any,
    { get: async () => inv } as any,
    {} as any,
    {
      html: pdf.html.bind(pdf),
      pdf: async (value: string) => {
        html = value;
        return Buffer.from("%PDF-test");
      },
    } as any,
  );
  const result = await service.preview(actor, inv.id);
  assert.equal(result.filename, "INV001.pdf");
  assert.match(html, /发票草稿 DRAFT/);
  assert.match(html, /草稿仅供核对/);
  assert.match(html, /B001/);
  assert.doesNotMatch(html, /<script>/);
});
test("issued bill invoices count without any receipt", async () => {
  const counts = await billInvoiceCounts(
    {
      income: { findMany: async () => [] },
      invoice: {
        groupBy: async ({ where }: any) => {
          assert.deepEqual(where.incomeId.in, ["bill"]);
          return [{ incomeId: "bill", _count: { _all: 1 } }];
        },
      },
    },
    ["bill"],
  );
  assert.equal(counts.get("bill"), 1);
});
test("project remarks validate multiline text and reject values above the form limit", () => {
  const p = {
    name: "项目",
    region: "港岛",
    address: "海湾路",
    remark: "第一行\n第二行",
  };
  assert.equal(ProjectsSchema.parse(p).remark, p.remark);
  assert.equal(
    ProjectsSchema.safeParse({ ...p, remark: "x".repeat(3001) }).success,
    false,
  );
});
