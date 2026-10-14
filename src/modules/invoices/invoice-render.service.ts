import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import {
  StoredFile,
  StorageService,
} from "../../common/storage/storage.service";
import { PdfService } from "../../common/storage/pdf.service";
import { demand, fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class InvoiceRenderService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(StorageService) readonly storage: StorageService,
    @Inject(PdfService) readonly pdfRenderer: PdfService,
  ) {}
  private documentHtml(inv: any) {
    const s = inv.snapshot || {};
    const dateText = (value: any) =>
      value
        ? String(value instanceof Date ? value.toISOString() : value).slice(
            0,
            10,
          )
        : "—";
    const title =
      inv.status === "DRAFT"
        ? "发票草稿 DRAFT"
        : inv.status === "VOID"
          ? "已作废发票 VOID"
          : "租赁发票 INVOICE";
    return this.pdfRenderer.html(
      title,
      [
        ["发票编号", inv.invoiceNo],
        ["出具日期", dateText(inv.issuedOn)],
        ["到期日", dateText(s.dueOn)],
        [
          "项目 / 单位",
          [s.projectName, s.unitNo].filter(Boolean).join(" · ") || "—",
        ],
        ["付款人", s.payerName],
        ["联系电话", s.payerPhone],
        [
          "关联费用",
          ({ RENT: "租金", DEPOSIT: "押金", OTHER: "其他费用" } as any)[
            s.feeType
          ] || s.feeType,
        ],
        ["账单 / 收款编号", s.billNo || s.recordNo],
        ["账期", `${dateText(s.periodStart)} ~ ${dateText(s.periodEnd)}`],
        ["金额", `${inv.currency} ${inv.amount}`],
      ],
      [
        inv.status === "DRAFT"
          ? "草稿仅供核对，尚未出具。"
          : inv.status === "VOID"
            ? "此发票已作废。"
            : "",
        s.remark,
      ]
        .filter(Boolean)
        .join("\n"),
    );
  }
  async preview(a: Actor, key: string) {
    const inv = await this.access.get(a, "invoices", key);
    return {
      filename: `${inv.invoiceNo}.pdf`,
      data: await this.pdfRenderer.pdf(this.documentHtml(inv)),
    };
  }
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
    let file: StoredFile | undefined;
    try {
      const buffer = await this.pdfRenderer.pdf(this.documentHtml(inv));
      file = await this.storage.save(buffer, "application/pdf");
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
      if (file) await this.storage.discard(file);
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
