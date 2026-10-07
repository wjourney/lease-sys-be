import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { StorageService } from "../../common/storage/storage.service";
import { createZip } from "../../common/storage/zip";
import { demand, fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { InvoiceRenderService } from "./invoice-render.service";

@Injectable()
export class InvoiceBatchService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(StorageService) readonly storage: StorageService,
    @Inject(InvoiceRenderService) readonly renderer: InvoiceRenderService,
  ) {}
  async download(actor: Actor, body: unknown) {
    demand(financial(actor));
    const { billIds } = z
      .object({ billIds: z.array(z.string().uuid()).min(1).max(20) })
      .strict()
      .parse(body);
    const files: { name: string; data: Buffer }[] = [];
    const report: string[] = [];
    const seen = new Set<string>();
    let bytes = 0,
      issues = 0;
    for (const billId of new Set(billIds)) {
      let bill: any;
      try {
        bill = await this.access.get(actor, "incomes", billId);
        if (bill.recordType !== "RECEIVABLE" || !bill.orderId)
          fail("请选择订单账单");
        if (bill.status === "VOID") {
          report.push(`${bill.recordNo}: 账单已作废，跳过`);
          issues++;
          continue;
        }
      } catch {
        report.push(`${billId}: 无权访问或账单不可用`);
        issues++;
        continue;
      }
      const receipts = await this.db.income.findMany({
        where: {
          parentId: billId,
          deletedAt: null,
          recordType: "RECEIPT",
          status: "CONFIRMED",
        },
        select: { id: true },
      });
      const invoices = await this.db.invoice.findMany({
        where: {
          incomeId: { in: receipts.map((r) => r.id) },
          deletedAt: null,
          status: "ACTIVE",
        },
        orderBy: { invoiceNo: "asc" },
        take: 101,
      });
      if (!invoices.length) {
        report.push(`${bill.recordNo}: 暂无有效发票，请先登记收款`);
        issues++;
        continue;
      }
      for (const invoice of invoices) {
        if (seen.has(invoice.id)) continue;
        seen.add(invoice.id);
        if (seen.size > 100 || bytes >= 50 * 1024 * 1024) {
          report.push(
            `${bill.recordNo}: 超过 100 张发票或 50 MB 上限，请减少勾选后下载`,
          );
          issues++;
          break;
        }
        try {
          const material = await this.renderer.render(actor, invoice.id);
          if (!material?.storageKey) throw new Error("PDF unavailable");
          const fresh = await this.access.get(actor, "invoices", invoice.id);
          if (fresh.status !== "ACTIVE") throw new Error("Invoice voided");
          const chunks: Buffer[] = [];
          const stream = await this.storage.open(material);
          for await (const chunk of stream) {
            const buffer = Buffer.from(chunk);
            bytes += buffer.length;
            if (bytes > 50 * 1024 * 1024) {
              stream.destroy();
              throw new Error("Archive size exceeded");
            }
            chunks.push(buffer);
          }
          files.push({
            name: `${bill.recordNo}_${invoice.invoiceNo}.pdf`,
            data: Buffer.concat(chunks),
          });
          report.push(`${bill.recordNo} / ${invoice.invoiceNo}: 下载成功`);
        } catch {
          report.push(
            `${bill.recordNo} / ${invoice.invoiceNo}: 下载未完成，请稍后重试`,
          );
          issues++;
        }
      }
    }
    const count = files.length;
    files.push({
      name: "下载结果.txt",
      data: Buffer.from(
        `发票 ${count} 张，未完成或跳过 ${issues} 项\n\n${report.join("\n")}`,
        "utf8",
      ),
    });
    return { zip: createZip(files), count, issues };
  }
}
