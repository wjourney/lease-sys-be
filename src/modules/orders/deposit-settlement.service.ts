import { ConflictException, Inject, Injectable } from "@nestjs/common";
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
        reason: z.string().trim().max(1000).optional(),
        revision: z.number().int().min(1).optional(),
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
        if (o.status !== "COMPLETED") fail("租约结束后才能结算押金");
        if (number(d.deductionAmount).gt(0) && !d.items?.length && !d.reason)
          fail("扣款时请填写扣款原因");
        const reason =
          d.reason ||
          (number(d.deductionAmount).gt(0) ? "押金扣款结算" : "全额退还押金");
        const items = (
          d.items ??
          (number(d.deductionAmount).gt(0)
            ? [{ label: "押金扣款", amount: d.deductionAmount, note: reason }]
            : [])
        ).map((item) => ({ ...item, amount: number(item.amount).toFixed(2) }));
        if (items.some((x) => number(x.amount).lte(0)))
          fail("扣款项目金额必须大于零");
        if (
          !items
            .reduce((n, x) => n.add(x.amount), number(0))
            .eq(d.deductionAmount)
        )
          fail("扣款合计与明细不一致");
        const unchanged =
          o.depositSettledAt &&
          number(o.depositDeductionAmount).eq(d.deductionAmount) &&
          o.depositDeductionReason === reason &&
          isDeepStrictEqual(
            plain(
              (Array.isArray(o.depositDeductions)
                ? o.depositDeductions
                : []
              ).map((item: any) => ({
                ...item,
                amount: number(item.amount).toFixed(2),
              })),
            ),
            plain(items),
          );
        if (unchanged) return o;
        if (d.revision !== undefined && d.revision !== o.revision)
          throw new ConflictException("押金资料已更新，请刷新后重新结算");
        if (o.depositSettledAt && d.revision === undefined)
          fail("修正押金结算需要最新版本，请刷新后重试");
        const refundRecords = await tx.expense.findMany({
          where: {
            orderId: key,
            feeType: "DEPOSIT_REFUND",
            deletedAt: null,
          },
          orderBy: { id: "asc" },
        });
        for (const refund of refundRecords)
          await lock(tx, "expenses", refund.id);
        const activeRefunds = refundRecords.filter((r) => r.status !== "VOID");
        if (!o.depositSettledAt && activeRefunds.length)
          fail("押金退款资料不一致，请先核对记录");
        if (
          o.depositSettledAt &&
          (activeRefunds.length !== 1 ||
            activeRefunds[0].status !== "UNPAID" ||
            number(activeRefunds[0].paidAmount).gt(0) ||
            (activeRefunds[0].paymentRecords as any[])?.length)
        )
          fail("押金已退款或已结清，不能修改结算");
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
        const previous = new Map<string, any>();
        if (o.depositSettledAt && Array.isArray(o.depositDeductions))
          for (const item of o.depositDeductions as any[])
            if (item.incomeId)
              previous.set(
                item.incomeId,
                (previous.get(item.incomeId) ?? number(0)).add(item.amount),
              );
        const billIds = [
          ...new Set([...byIncome.keys(), ...previous.keys()]),
        ].sort();
        for (const id of billIds) {
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
          const oldOffset = previous.get(id) ?? number(0);
          const offset = byIncome.get(id) ?? number(0);
          if (offset.eq(oldOffset)) continue;
          if (oldOffset.gt(bill.depositOffsetAmount))
            fail("抵扣账单已变化，请刷新后重新结算");
          if (o.depositSettledAt && confirmed.gt(0))
            fail("抵扣账单已登记收款，不能修改该笔抵扣");
          if (offset.gt(remaining.add(oldOffset)))
            fail("押金抵扣金额超过账单剩余应收");
          await update(
            tx,
            "incomes",
            bill,
            {
              depositOffsetAmount: number(bill.depositOffsetAmount)
                .sub(oldOffset)
                .add(offset),
              status: remaining.add(oldOffset).eq(offset) ? "PAID" : "OPEN",
            },
            a,
            `押金抵扣：${reason}`,
          );
        }
        // End the uncollected deposit obligation as part of explicit settlement.
        // The original contracted deposit stays on the order and in the audit trail.
        for (const bill of o.depositSettledAt ? [] : roots) {
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
            `退租押金结算，终止未收押金：${reason}`,
          );
        }
        const refund = received.sub(d.deductionAmount);
        const existingRefund = activeRefunds[0];
        if (existingRefund)
          await update(
            tx,
            "expenses",
            existingRefund,
            {
              amount: refund,
              status: refund.gt(0) ? "UNPAID" : "VOID",
              remark: reason,
            },
            a,
            `修正押金结算：${reason}`,
          );
        else if (refund.gt(0))
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
              remark: reason,
            },
            a,
          );
        return update(
          tx,
          "orders",
          o,
          {
            depositDeductionAmount: d.deductionAmount,
            depositDeductionReason: reason,
            depositDeductions: plain(items),
            depositSettledAt: o.depositSettledAt ?? new Date(),
          },
          a,
          reason,
        );
      },
      { timeout: 15000 },
    );
  }
}
