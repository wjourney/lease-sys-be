import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { serial } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class InvoiceLifecycleService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
  ) {}
  async voidInvoice(a: Actor, key: string, reason: string, reissue = false) {
    demand(financial(a));
    if (!reason?.trim()) fail("请填写原因");
    return this.db.$transaction(async (tx) => {
      const initial = await this.access.get(a, "invoices", key, tx);
      const income = await tx.income.findUnique({ where: { id: initial.incomeId } });
      if (income?.orderId) await lock(tx, "orders", income.orderId);
      if (income?.parentId) await lock(tx, "incomes", income.parentId);
      await lock(tx, "incomes", initial.incomeId);
      await lock(tx, "invoices", key);
      const old = await this.access.get(a, "invoices", key, tx);
      if (!["DRAFT", "ACTIVE"].includes(old.status)) fail("发票已经作废");
      if (reissue && old.status !== "ACTIVE") fail("草稿请直接编辑后出具");
      await update(
        tx,
        "invoices",
        old,
        { status: "VOID", voidReason: reason },
        a,
        reason,
      );
      if (!reissue) return { ok: true };
      return insert(
        tx,
        "invoices",
        {
          invoiceNo: serial("INV"),
          incomeId: old.incomeId,
          amount: old.amount,
          currency: old.currency,
          issuedOn: new Date(),
          snapshot: old.snapshot,
          replacesInvoiceId: old.id,
        },
        a,
      );
    });
  }
}
