import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:net";
import { InvoiceEmailService } from "../src/modules/invoices/invoice-email.service";

const actor: any = {
  id: randomUUID(),
  name: "财务",
  role: "FINANCE",
  salesCompanyId: null,
  authVersion: 1,
};

function fixture() {
  const invoice: any = {
    id: randomUUID(),
    invoiceNo: "INV-TEST-001",
    status: "ACTIVE",
    renderStatus: "READY",
    emailStatus: "IDLE",
    emailAttempts: 0,
    emailRequestId: null,
    emailTo: null,
    emailSubject: null,
    revision: 1,
    operationLogs: [],
  };
  const db: any = {
    $transaction: async (fn: any) => fn(db),
    $queryRawUnsafe: async () => [],
    invoice: {
      findUnique: async () => ({ ...invoice }),
      updateMany: async ({ where, data }: any) => {
        if (where.id !== invoice.id) return { count: 0 };
        if (where.emailStatus && where.emailStatus !== invoice.emailStatus)
          return { count: 0 };
        if (where.revision && where.revision !== invoice.revision)
          return { count: 0 };
        for (const [key, value] of Object.entries(data)) {
          const increment = (value as any)?.increment;
          invoice[key] = increment ? invoice[key] + increment : value;
        }
        return { count: 1 };
      },
    },
    material: {
      findFirst: async () => ({
        storageProvider: "LOCAL",
        storageKey: "invoice.pdf",
      }),
    },
  };
  const access: any = { get: async () => ({ ...invoice }) };
  const storage: any = { read: async () => Buffer.from("%PDF-1.4\n%%EOF") };
  return {
    invoice,
    db,
    service: new InvoiceEmailService(db, access, storage),
  };
}

async function until(predicate: () => boolean) {
  for (let n = 0; n < 100; n++) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail("Timed out waiting for email delivery result");
}

test("sending an invoice starts delivery immediately and records SMTP acceptance", async () => {
  const previous = Object.fromEntries(
    ["SMTP_HOST", "SMTP_PORT", "SMTP_FROM", "SMTP_USER", "SMTP_PASSWORD"].map(
      (key) => [key, process.env[key]],
    ),
  );
  let message = "";
  const server = createServer((socket) => {
    socket.write("220 localhost ESMTP\r\n");
    let input = "";
    let data = false;
    socket.on("data", (chunk) => {
      input += chunk.toString();
      if (data) {
        const end = input.indexOf("\r\n.\r\n");
        if (end >= 0) {
          message += input.slice(0, end);
          input = input.slice(end + 5);
          data = false;
          socket.write("250 2.0.0 queued\r\n");
        } else {
          message += input;
          input = "";
        }
      }
      let lineEnd: number;
      while (!data && (lineEnd = input.indexOf("\r\n")) >= 0) {
        const command = input.slice(0, lineEnd);
        input = input.slice(lineEnd + 2);
        if (command.startsWith("EHLO"))
          socket.write("250-localhost\r\n250 SIZE 100000\r\n");
        else if (command.startsWith("DATA")) {
          data = true;
          socket.write("354 End data with <CR><LF>.<CR><LF>\r\n");
        } else if (command.startsWith("QUIT")) {
          socket.write("221 Bye\r\n");
          socket.end();
        } else socket.write("250 OK\r\n");
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    process.env.SMTP_HOST = "127.0.0.1";
    process.env.SMTP_PORT = String((server.address() as any).port);
    process.env.SMTP_FROM = "billing@example.test";
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASSWORD;
    const { invoice, service } = fixture();
    const requestId = randomUUID();
    await service.send(actor, invoice.id, {
      emailTo: "recipient@example.test",
      emailSubject: "测试发票",
      requestId,
    });
    await until(() => invoice.emailStatus === "SENT");
    assert.equal(invoice.emailAttempts, 1);
    assert.ok(invoice.lastSentAt instanceof Date);
    assert.match(message, /recipient@example\.test/);
    assert.match(message, /INV-TEST-001\.pdf/);
    await service.send(actor, invoice.id, {
      emailTo: "recipient@example.test",
      emailSubject: "测试发票",
      requestId,
    });
    assert.equal(invoice.emailAttempts, 1);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
    for (const [key, value] of Object.entries(previous)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("an incomplete mail configuration rejects the request before it is queued", async () => {
  const previousHost = process.env.SMTP_HOST;
  const previousFrom = process.env.SMTP_FROM;
  try {
    process.env.SMTP_HOST = "smtp.example.test";
    delete process.env.SMTP_FROM;
    const { invoice, service } = fixture();
    await assert.rejects(
      service.send(actor, invoice.id, {
        emailTo: "recipient@example.test",
        emailSubject: "测试发票",
        requestId: randomUUID(),
      }),
      /邮件服务未配置完整/,
    );
    assert.equal(invoice.emailStatus, "IDLE");
  } finally {
    if (previousHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previousHost;
    if (previousFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = previousFrom;
  }
});

test("a missing PDF is a definite failure, not an uncertain delivery", async () => {
  const previousHost = process.env.SMTP_HOST;
  const previousFrom = process.env.SMTP_FROM;
  try {
    process.env.SMTP_HOST = "smtp.example.test";
    process.env.SMTP_FROM = "billing@example.test";
    const { invoice, db, service } = fixture();
    invoice.emailStatus = "PENDING";
    invoice.emailTo = "recipient@example.test";
    invoice.emailSubject = "测试发票";
    invoice.emailRequestId = randomUUID();
    db.material.findFirst = async () => null;
    await service.sendPending(actor, invoice.id);
    assert.equal(invoice.emailStatus, "FAILED");
    assert.match(invoice.emailLastError, /缺少发票文件/);
  } finally {
    if (previousHost === undefined) delete process.env.SMTP_HOST;
    else process.env.SMTP_HOST = previousHost;
    if (previousFrom === undefined) delete process.env.SMTP_FROM;
    else process.env.SMTP_FROM = previousFrom;
  }
});
