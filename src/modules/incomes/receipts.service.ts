import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { number, plain, serial } from "../../common/utils/value";
import { date, money } from "../../common/validation/fields";
import { PrismaService } from "../../database/prisma.service";
import { AccountValidationService } from "../fund-accounts/account-validation.service";
import { IncomeBalanceService } from "./income-balance.service";
@Injectable()
export class ReceiptsService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(IncomeBalanceService) readonly balances: IncomeBalanceService,
    @Inject(AccountValidationService)
    readonly accounts: AccountValidationService,
  ) {}
  async receipt(a: Actor, key: string, body: any) {
    demand(
      [
        "SUPER_ADMIN",
        "FINANCE",
        "OPERATIONS",
        "SALES_COMPANY_ADMIN",
        "SALES",
      ].includes(a.role),
    );
    const d = z
      .object({
        amount: money,
        receivedOn: date,
        fundAccountId: z.string().uuid(),
        paymentMethod: z.string().min(1),
        bankReference: z.string().optional(),
        payerName: z.string().min(1),
        remark: z.string().optional(),
        sourceKey: z.string().uuid(),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      const first = await this.access.get(a, "incomes", key, tx);
      if (first.orderId) await lock(tx, "orders", first.orderId);
      await lock(tx, "incomes", key);
      const root = await this.access.get(a, "incomes", key, tx);
      if (root.recordType !== "RECEIVABLE" || root.status === "VOID")
        fail("当前收入不允许收款");
      const exists = await tx.income.findUnique({
        where: { sourceKey: d.sourceKey },
      });
      if (exists) {
        if (exists.parentId !== key || !number(exists.amount).eq(d.amount))
          fail("重复提交编号冲突");
        return exists;
      }
      if (root.orderId && root.feeType === "DEPOSIT") {
        const order = await this.access.get(a, "orders", root.orderId, tx);
        if (order.depositSettledAt) fail("押金已结算，不能继续登记收款");
      }
      const sums = await this.balances.totals(tx, key);
      if (number(d.amount).lte(0) || number(d.amount).gt(sums.available))
        fail("金额超过可登记余额");
      await this.accounts.checkAccount(tx, d.fundAccountId, root.currency);
      const child = await insert(
        tx,
        "incomes",
        {
          ...d,
          recordNo: serial("RC"),
          recordType: "RECEIPT",
          parentId: key,
          feeType: root.feeType,
          currency: root.currency,
          status: "PENDING",
        },
        a,
      );
      if (root.orderId) {
        const order = await tx.order.findUnique({
          where: { id: root.orderId },
        });
        if (order && !order.firstPaymentRegisteredAt)
          await update(
            tx,
            "orders",
            order,
            {
              firstPaymentRegisteredAt: new Date(),
              occupancyState: "OCCUPIED",
            },
            a,
            "登记首笔付款",
          );
      }
      return child;
    });
  }
  async confirm(a: Actor, key: string, approve: boolean, reason?: string) {
    demand(financial(a));
    return this.db.$transaction(
      async (tx) => {
        const first = await this.access.get(a, "incomes", key, tx);
        if (first.recordType !== "RECEIPT" || !first.parentId)
          fail("只能核对实际收款明细");
        const parent = await tx.income.findUnique({
          where: { id: first.parentId },
        });
        if (parent?.orderId) await lock(tx, "orders", parent.orderId);
        await lock(tx, "incomes", first.parentId);
        await lock(tx, "incomes", key);
        const r = await this.access.get(a, "incomes", key, tx);
        if (r.status !== "PENDING") {
          if (r.status === (approve ? "CONFIRMED" : "REJECTED")) return r;
          fail("该收款已处理");
        }
        if (!approve && !reason?.trim()) fail("请输入驳回原因");
        const result = await update(
          tx,
          "incomes",
          r,
          {
            status: approve ? "CONFIRMED" : "REJECTED",
            confirmedBy: a.id,
            confirmedAt: new Date(),
            rejectionReason: approve ? null : reason,
          },
          a,
          approve ? "确认到账" : reason,
        );
        const root = await tx.income.findUnique({ where: { id: r.parentId! } });
        const totals = await this.balances.totals(tx, root!.id);
        await update(
          tx,
          "incomes",
          root,
          {
            status: totals.remaining.eq(0)
              ? "PAID"
              : totals.confirmed.gt(0)
                ? "PARTIAL"
                : "OPEN",
          },
          a,
          "更新收款进度",
        );
        if (approve)
          await insert(
            tx,
            "invoices",
            {
              invoiceNo: serial("INV"),
              incomeId: r.id,
              amount: r.amount,
              currency: r.currency,
              issuedOn: new Date(),
              snapshot: plain({
                payerName: r.payerName || root!.payerName,
                payerEmail: root!.payerEmail,
                feeType: root!.feeType,
                orderId: root!.orderId,
                periodStart: root!.periodStart,
                periodEnd: root!.periodEnd,
                amount: r.amount,
                recordNo: r.recordNo,
                dueOn: root!.dueOn,
              }),
            },
            a,
          );
        if (root!.orderId) {
          const o = await tx.order.findUnique({ where: { id: root!.orderId } });
          if (o?.status === "PENDING") {
            const initial = await tx.income.findMany({
              where: {
                orderId: o.id,
                recordType: "RECEIVABLE",
                deletedAt: null,
                status: { not: "VOID" },
                OR: [
                  { feeType: "DEPOSIT" },
                  {
                    sourceKey: `rent:${o.id}:${o.startsOn.toISOString().slice(0, 10)}`,
                  },
                ],
              },
            });
            let full = true;
            for (const p of initial)
              if ((await this.balances.totals(tx, p.id)).remaining.gt(0))
                full = false;
            const pending = await tx.income.count({
              where: {
                parentId: { in: initial.map((x) => x.id) },
                status: { in: ["PENDING", "CONFIRMED"] },
              },
            });
            await update(
              tx,
              "orders",
              o,
              {
                status: full ? "ACTIVE" : "PENDING",
                occupancyState: full || pending ? "OCCUPIED" : "LOCKED",
              },
              a,
              "更新租赁生效状态",
            );
          }
        }
        return result;
      },
      { timeout: 15000 },
    );
  }
}
