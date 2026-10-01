import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { LocalStorageService } from "../../common/storage/local-storage.service";
import { PdfService } from "../../common/storage/pdf.service";
import { demand, fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class InvoiceRenderService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(LocalStorageService) readonly storage: LocalStorageService,
    @Inject(PdfService) readonly pdfRenderer: PdfService,
  ) {}
  async render(a: Actor, key: string) {
    demand(financial(a));
    const inv = await this.access.get(a, "invoices", key);
    if (inv.status !== "ACTIVE") fail("作废发票不可生成");
    if (inv.renderStatus === "READY")
      return this.db.material.findFirst({
        where: { invoiceId: key, deletedAt: null, isCurrent: true },
      });
    const claimed = await this.db.invoice.updateMany({
      where: { id: key, renderStatus: { in: ["PENDING", "FAILED"] } },
      data: {
        renderStatus: "PROCESSING",
        renderAttempts: { increment: 1 },
        renderNextRetryAt: new Date(Date.now() + 600000),
      },
    });
    if (!claimed.count) fail("发票正在生成");
    try {
      const s = inv.snapshot as any;
      const buffer = await this.pdfRenderer.pdf(
        this.pdfRenderer.html("租赁发票 INVOICE", [
          ["发票号码", inv.invoiceNo],
          ["开具日期", inv.issuedOn.toISOString().slice(0, 10)],
          ["付款方", s.payerName],
          [
            "费用类型",
            s.feeType === "RENT"
              ? "租金"
              : s.feeType === "DEPOSIT"
                ? "押金"
                : "其他收入",
          ],
          ["收款编号", s.recordNo],
          ["金额", `${inv.currency} ${inv.amount}`],
        ]),
      );
      const file = await this.storage.save(buffer);
      return await this.db.$transaction(async (tx) => {
        await lock(tx, "invoices", key);
        const fresh = await tx.invoice.findUnique({ where: { id: key } });
        if (fresh?.status !== "ACTIVE") fail("发票已作废");
        const m = await insert(
          tx,
          "materials",
          {
            invoiceId: key,
            category: "INVOICE",
            title: inv.invoiceNo,
            ...file,
            originalName: inv.invoiceNo + ".pdf",
            mimeType: "application/pdf",
          },
          a,
        );
        await update(
          tx,
          "invoices",
          fresh,
          { renderStatus: "READY", renderError: null, renderNextRetryAt: null },
          a,
          "生成 PDF",
        );
        return m;
      });
    } catch (e) {
      const current = await this.db.invoice.findUnique({ where: { id: key } });
      if (current)
        await this.db.$transaction((tx) =>
          update(
            tx,
            "invoices",
            current,
            {
              renderStatus: "FAILED",
              renderError: (e as Error).message.slice(0, 500),
              renderNextRetryAt: new Date(
                Date.now() + 60000 * Math.min(30, 2 ** inv.renderAttempts),
              ),
            },
            a,
            "PDF 生成失败",
          ),
        );
      throw e;
    }
  }
}
