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
    if (!process.env.SMTP_HOST) fail("尚未配置邮件服务，请先下载发票");
    return this.db.$transaction(async (tx) => {
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
        },
        a,
        "请求发送发票",
      );
    });
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
      if (!["UNKNOWN", "SENDING"].includes(inv.emailStatus))
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
      !process.env.SMTP_HOST
    )
      return;
    const claim = await this.db.invoice.updateMany({
      where: { id: key, emailStatus: "PENDING" },
      data: { emailStatus: "SENDING", emailAttempts: { increment: 1 } },
    });
    if (!claim.count) return;
    try {
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
      await transport.sendMail({
        from: process.env.SMTP_FROM,
        to: inv.emailTo!,
        subject: inv.emailSubject!,
        messageId: `<${inv.emailRequestId}@lease.local>`,
        text: "请查收附件中的发票。",
        attachments: [
          {
            filename: inv.invoiceNo + ".pdf",
            content: await this.storage.read({
              storageProvider: m.storageProvider,
              storageKey: m.storageKey,
            }),
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
      await this.db.$transaction((tx) =>
        update(
          tx,
          "invoices",
          row,
          {
            emailStatus: "UNKNOWN",
            emailLastError: (e as Error).message.slice(0, 500),
            emailNextRetryAt: null,
          },
          a,
          "发送结果待核验",
        ),
      );
    }
  }
}
