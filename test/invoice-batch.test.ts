import "reflect-metadata";
import assert from "node:assert/strict";
import { test } from "node:test";
import { randomUUID } from "node:crypto";
import { Readable } from "node:stream";
import { execFileSync } from "node:child_process";
import { InvoiceBatchService } from "../src/modules/invoices/invoice-batch.service";
const actor: any = { id: randomUUID(), role: "SUPER_ADMIN" };
const id = randomUUID(),
  empty = randomUUID(),
  denied = randomUUID();
function harness() {
  const rendered: string[] = [],
    checked: string[] = [];
  const db: any = {
    income: {
      findMany: async ({ where }: any) => {
        assert.equal(where.status, "CONFIRMED");
        assert.equal(where.recordType, "RECEIPT");
        assert.equal(where.deletedAt, null);
        return where.parentId === empty ? [] : [{ id: "receipt" }];
      },
    },
    invoice: {
      findMany: async ({ where }: any) => {
        assert.equal(where.status, "ACTIVE");
        assert.equal(where.deletedAt, null);
        return where.incomeId.in.length
          ? [
              { id: "i1", invoiceNo: "INV001" },
              { id: "i2", invoiceNo: "INV002" },
            ]
          : [];
      },
    },
  };
  const access: any = {
    get: async (_: any, resource: string, key: string) => {
      checked.push(key);
      if (key === denied) throw new Error("permission denied");
      return resource === "invoices"
        ? { status: "ACTIVE" }
        : {
            id: key,
            recordNo: key === empty ? "B002" : "B001",
            recordType: "RECEIVABLE",
            orderId: "order",
            status: "OPEN",
          };
    },
  };
  const service = new InvoiceBatchService(
    db,
    access,
    { open: async () => Readable.from([Buffer.from("%PDF-mocked")]) } as any,
    {
      render: async (_: any, key: string) => {
        rendered.push(key);
        if (key === "i2") throw new Error("private storage stack");
        return { storageKey: "file", storageProvider: "LOCAL" };
      },
    } as any,
  );
  return { service, rendered, checked };
}
function unzip(zip: Buffer) {
  return JSON.parse(
    execFileSync(
      "python3",
      [
        "-c",
        "import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()},ensure_ascii=False))",
      ],
      { input: zip },
    ).toString(),
  );
}
test("invoice batch checks each bill, deduplicates, downloads valid PDFs and lists skipped/failing items", async () => {
  const { service, rendered, checked } = harness();
  const result = await service.download(actor, {
    billIds: [id, id, empty, denied],
  });
  assert.equal(result.count, 1);
  assert.equal(result.issues, 3);
  assert.deepEqual(rendered, ["i1", "i2"]);
  assert.equal(checked.filter((key) => key === id).length, 1);
  const files = unzip(result.zip);
  assert.equal(files["B001_INV001.pdf"], "%PDF-mocked");
  assert.match(files["下载结果.txt"], /暂无有效发票/);
  assert.match(files["下载结果.txt"], /无权访问/);
  assert.match(files["下载结果.txt"], /下载未完成/);
  assert.doesNotMatch(files["下载结果.txt"], /private storage/);
});
test("invoice batch rejects non-financial roles, malformed IDs and oversized requests before accessing data", async () => {
  const { service, checked } = harness();
  for (const role of ["SALES", "SALES_COMPANY_ADMIN", "OPERATIONS"])
    await assert.rejects(
      service.download({ ...actor, role }, { billIds: [id] }),
    );
  for (const billIds of [[], ["invalid"], Array(21).fill(id)])
    await assert.rejects(service.download(actor, { billIds }));
  assert.deepEqual(checked, []);
});
test("empty invoice selection provides an explicit result manifest without fabricated PDFs", async () => {
  const { service } = harness();
  const result = await service.download(actor, { billIds: [empty] });
  assert.equal(result.count, 0);
  assert.deepEqual(Object.keys(unzip(result.zip)), ["下载结果.txt"]);
});
