import { Inject, Injectable } from "@nestjs/common";
import nodemailer from "nodemailer";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { lock, update } from "../../common/database/record-mutations";
import { StorageService } from "../../common/storage/storage.service";
import { demand, fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class InvoiceEmailService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(StorageService) readonly storage: StorageService,
  ) {}
  async send(a: Actor, key: string, body: any) {
    demand(financial(a));
    const d = z
      .object({
        emailTo: z.email(),
        emailSubject: z.string().min(1),
        requestId: z.string().uuid(),
      })
      .strict()
      .parse(body);
    if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
      fail("邮件服务未配置完整，请联系管理员配置发件服务器和发件邮箱");
    if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD))
      fail("邮件服务账号或密码未配置完整，请联系管理员");
    const invoice = await this.db.$transaction(async (tx) => {
      await lock(tx, "invoices", key);
      const inv = await this.access.get(a, "invoices", key, tx);
      if (inv.status !== "ACTIVE") fail("作废发票不能发送");
      if (inv.emailRequestId === d.requestId) return inv;
      if (["PENDING", "SENDING", "UNKNOWN"].includes(inv.emailStatus))
        fail("正在发送或发送结果待核验，请勿重复提交");
      return update(
        tx,
        "invoices",
        inv,
        {
          emailTo: d.emailTo,
          emailSubject: d.emailSubject,
          emailRequestId: d.requestId,
          emailStatus: "PENDING",
          emailAttempts: 0,
          emailNextRetryAt: new Date(),
          emailLastError: null,
        },
        a,
        "请求发送发票",
      );
    });
    // Start delivery after the transaction commits. The scheduler remains a backup
    // if this process exits before the task finishes.
    void this.sendPending(a, key).catch((error) =>
      console.error("Invoice email task failed", key, error),
    );
    return invoice;
  }
  async resolveEmail(a: Actor, key: string, body: any) {
    demand(financial(a));
    const d = z
      .object({
        resolution: z.enum(["SENT", "RETRY"]),
        reason: z.string().min(1),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "invoices", key);
      const inv = await this.access.get(a, "invoices", key, tx);
      if (inv.emailStatus !== "UNKNOWN")
        fail("当前发送状态无需人工核验");
      return update(
        tx,
        "invoices",
        inv,
        {
          emailStatus: d.resolution === "SENT" ? "SENT" : "PENDING",
          lastSentAt: d.resolution === "SENT" ? new Date() : inv.lastSentAt,
          emailNextRetryAt: d.resolution === "RETRY" ? new Date() : null,
        },
        a,
        d.reason,
      );
    });
  }
  async sendPending(a: Actor, key: string) {
    const inv = await this.db.invoice.findUnique({ where: { id: key } });
    if (
      !inv ||
      inv.status !== "ACTIVE" ||
      inv.renderStatus !== "READY" ||
      inv.emailStatus !== "PENDING"
    )
      return;
    const claim = await this.db.invoice.updateMany({
      where: { id: key, emailStatus: "PENDING" },
      data: {
        emailStatus: "SENDING",
        emailAttempts: { increment: 1 },
        emailNextRetryAt: new Date(Date.now() + 10 * 60_000),
      },
    });
    if (!claim.count) return;
    let deliveryStarted = false;
    try {
      if (!process.env.SMTP_HOST || !process.env.SMTP_FROM)
        throw new Error("邮件服务未配置完整，请联系管理员");
      if (Boolean(process.env.SMTP_USER) !== Boolean(process.env.SMTP_PASSWORD))
        throw new Error("邮件服务账号或密码未配置完整，请联系管理员");
      const m = await this.db.material.findFirst({
        where: { invoiceId: key, deletedAt: null, isCurrent: true },
      });
      if (!m?.storageKey) throw new Error("缺少发票文件");
      const transport = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT || 587),
        secure: process.env.SMTP_PORT === "465",
        auth: process.env.SMTP_USER
          ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASSWORD }
          : undefined,
      });
      const attachment = await this.storage.read({
        storageProvider: m.storageProvider,
        storageKey: m.storageKey,
      });
      const fromDomain =
        process.env.SMTP_FROM.match(/@([^>\s]+)/)?.[1] || "lease.local";
      deliveryStarted = true;
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: inv.emailTo!,
        subject: inv.emailSubject!,
        messageId: `<${inv.emailRequestId}@${fromDomain}>`,
        text: "请查收附件中的发票。",
        attachments: [
          {
            filename: inv.invoiceNo + ".pdf",
            content: attachment,
          },
        ],
      });
      const row = await this.db.invoice.findUnique({ where: { id: key } });
      await this.db.$transaction((tx) =>
        update(
          tx,
          "invoices",
          row,
          {
            emailStatus: "SENT",
            lastSentAt: new Date(),
            emailLastError: null,
            emailNextRetryAt: null,
          },
          a,
          "发票邮件已发送",
        ),
      );
    } catch (e) {
      const row = await this.db.invoice.findUnique({ where: { id: key } });
      const rawError = e instanceof Error ? e.message : String(e);
      const safeError = process.env.SMTP_PASSWORD
        ? rawError.replaceAll(process.env.SMTP_PASSWORD, "[REDACTED]")
        : rawError;
      await this.db.$transaction((tx) =>
        update(
          tx,
          "invoices",
          row,
          {
            emailStatus:
              deliveryStarted && !["EAUTH", "EENVELOPE", "EMESSAGE"].includes(
                (e as Error & { code?: string }).code || "",
              )
                ? "UNKNOWN"
                : "FAILED",
            emailLastError: safeError.slice(0, 500),
            emailNextRetryAt: null,
          },
          a,
          deliveryStarted ? "发票邮件发送异常" : "发票邮件发送失败",
        ),
      );
    }
  }
}
