import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { number, plain, serial } from "../../common/utils/value";
import { money } from "../../common/validation/fields";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class DepositSettlementService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
  ) {}
  async deposit(a: Actor, key: string, body: any) {
    demand(financial(a));
    const d = z
      .object({
        deductionAmount: money,
        reason: z.string().trim().min(1),
        items: z
          .array(
            z
              .object({
                label: z.string().trim().min(1),
                amount: money,
                note: z.string().trim().min(1),
                incomeId: z.string().uuid().optional(),
                materialId: z.string().uuid().optional(),
              })
              .strict(),
          )
          .max(50)
          .optional(),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx, "orders", key);
        const o = await this.access.get(a, "orders", key, tx);
        if (o.status !== "COMPLETED" || o.handoverStatus !== "DONE")
          fail("交还完成后才能结算押金");
        const items =
          d.items ??
          (number(d.deductionAmount).gt(0)
            ? [{ label: "押金扣款", amount: d.deductionAmount, note: d.reason }]
            : []);
        if (items.some((x) => number(x.amount).lte(0)))
          fail("扣款项目金额必须大于零");
        if (
          !items
            .reduce((n, x) => n.add(x.amount), number(0))
            .eq(d.deductionAmount)
        )
          fail("扣款合计与明细不一致");
        if (o.depositSettledAt) {
          if (
            number(o.depositDeductionAmount).eq(d.deductionAmount) &&
            o.depositDeductionReason === d.reason &&
            isDeepStrictEqual(o.depositDeductions, plain(items))
          )
            return o;
          fail("押金已结算，请勿重复修改");
        }
        const roots = await tx.income.findMany({
          where: {
            orderId: key,
            recordType: "RECEIVABLE",
            feeType: "DEPOSIT",
            deletedAt: null,
            status: { not: "VOID" },
          },
          orderBy: { id: "asc" },
        });
        for (const r of roots) await lock(tx, "incomes", r.id);
        const receipts = await tx.income.findMany({
          where: {
            parentId: { in: roots.map((x) => x.id) },
            deletedAt: null,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
        });
        if (receipts.some((x) => x.status === "PENDING"))
          fail("押金有待确认收款，请先确认或驳回后再结算");
        const received = receipts.reduce((n, x) => n.add(x.amount), number(0));
        if (number(d.deductionAmount).gt(received))
          fail("扣除金额超过实收押金");
        const byIncome = new Map<string, any>();
        for (const item of items) {
          if (item.materialId) {
            const material = await this.access.get(
              a,
              "materials",
              item.materialId,
              tx,
            );
            if (material.orderId !== key) fail("扣款凭证必须属于当前订单");
          }
          if (item.incomeId)
            byIncome.set(
              item.incomeId,
              (byIncome.get(item.incomeId) ?? number(0)).add(item.amount),
            );
        }
        for (const id of [...byIncome.keys()].sort()) {
          await lock(tx, "incomes", id);
          const bill = await this.access.get(a, "incomes", id, tx);
          if (
            bill.orderId !== key ||
            bill.recordType !== "RECEIVABLE" ||
            bill.feeType === "DEPOSIT" ||
            bill.status === "VOID"
          )
            fail("请选择本订单有效的非押金欠款账单");
          const children = await tx.income.findMany({
            where: {
              parentId: id,
              deletedAt: null,
              status: { in: ["PENDING", "CONFIRMED"] },
            },
          });
          if (children.some((x) => x.status === "PENDING"))
            fail("抵扣账单有待确认收款，请先处理");
          const confirmed = children.reduce(
            (n, x) => n.add(x.amount),
            number(0),
          );
          const remaining = number(bill.amount)
            .add(bill.adjustmentAmount)
            .sub(confirmed)
            .sub(bill.depositOffsetAmount);
          const offset = byIncome.get(id);
          if (offset.gt(remaining)) fail("押金抵扣金额超过账单剩余应收");
          await update(
            tx,
            "incomes",
            bill,
            {
              depositOffsetAmount: number(bill.depositOffsetAmount).add(offset),
              status: remaining.eq(offset) ? "PAID" : "OPEN",
            },
            a,
            `押金抵扣：${d.reason}`,
          );
        }
        // End the uncollected deposit obligation as part of explicit settlement.
        // The original contracted deposit stays on the order and in the audit trail.
        for (const bill of roots) {
          const paid = receipts
            .filter((r) => r.parentId === bill.id)
            .reduce((n, r) => n.add(r.amount), number(0));
          await update(
            tx,
            "incomes",
            bill,
            {
              adjustmentAmount: paid.sub(bill.amount),
              status: paid.gt(0) ? "PAID" : "VOID",
            },
            a,
            `退租押金结算，终止未收押金：${d.reason}`,
          );
        }
        const refund = received.sub(d.deductionAmount);
        if (refund.gt(0))
          await insert(
            tx,
            "expenses",
            {
              expenseNo: serial("E"),
              orderId: key,
              projectId: o.projectId,
              unitId: o.unitId,
              originalIncomeId: receipts[0]?.id,
              feeType: "DEPOSIT_REFUND",
              amount: refund,
              currency: o.currency,
              payeeName: o.tenantName,
              dueOn: new Date(),
              sourceKey: `deposit-refund:${key}`,
              remark: d.reason,
            },
            a,
          );
        return update(
          tx,
          "orders",
          o,
          {
            depositDeductionAmount: d.deductionAmount,
            depositDeductionReason: d.reason,
            depositDeductions: plain(items),
            depositSettledAt: new Date(),
          },
          a,
          d.reason,
        );
      },
      { timeout: 15000 },
    );
  }
}
