import { randomUUID } from "node:crypto";
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
    const d = ReceiptInput.parse(body);
    return this.db.$transaction(async (tx) => {
      const first = await this.access.get(a, "incomes", key, tx);
      if (first.orderId) await lock(tx, "orders", first.orderId);
      await lock(tx, "incomes", key);
      const root = await this.access.get(a, "incomes", key, tx);
      return this.register(tx, a, root, d);
    });
  }
  // The caller locks the order and bills. Shared by initial and later payments.
  async register(
    tx: any,
    a: Actor,
    root: any,
    d: any,
    group?: string,
    voucherIncomeId?: string,
  ) {
    if (root.recordType !== "RECEIVABLE" || root.status === "VOID")
      fail("当前账单不允许收款");
    const exists = await tx.income.findUnique({
      where: { sourceKey: d.sourceKey },
    });
    if (exists) {
      if (
        exists.parentId !== root.id ||
        !number(exists.amount).eq(d.amount) ||
        exists.fundAccountId !== d.fundAccountId ||
        exists.paymentMethod !== d.paymentMethod ||
        exists.receivedOn?.getTime() !== d.receivedOn.getTime() ||
        exists.payerName !== d.payerName ||
        (exists.bankReference || "") !== (d.bankReference || "")
      )
        fail("重复提交编号冲突");
      return exists;
    }
    const order = root.orderId
      ? await tx.order.findUnique({ where: { id: root.orderId } })
      : null;
    if (order?.status === "CLOSED") fail("订单已关闭，不能继续登记收款");
    if (order?.depositSettledAt && root.feeType === "DEPOSIT")
      fail("押金已结算，不能继续登记收款");
    const sums = await this.balances.totals(tx, root.id);
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
        parentId: root.id,
        orderId: root.orderId,
        projectId: root.projectId,
        unitId: root.unitId,
        feeType: root.feeType,
        currency: root.currency,
        status: "PENDING",
        ...(group
          ? {
              recurrenceRule: {
                receiptGroupId: group,
                ...(voucherIncomeId ? { voucherIncomeId } : {}),
              },
            }
          : {}),
      },
      a,
    );
    if (order && !order.firstPaymentRegisteredAt)
      await update(
        tx,
        "orders",
        order,
        { firstPaymentRegisteredAt: new Date() },
        a,
        "登记首笔付款，等待财务核对",
      );
    return child;
  }
  async batch(a: Actor, orderId: string, body: any) {
    const d = ReceiptInput.omit({ amount: true })
      .extend({
        allocations: z
          .array(
            z.object({ billId: z.string().uuid(), amount: money }).strict(),
          )
          .min(1)
          .max(50),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(
      async (tx) => {
        await this.access.get(a, "orders", orderId, tx);
        await lock(tx, "orders", orderId);
        if (
          new Set(d.allocations.map((x) => x.billId)).size !==
          d.allocations.length
        )
          fail("同一账单不能重复分配");
        const { allocations, sourceKey, ...payment } = d;
        const receipts: any[] = [];
        const prior = await tx.income.findMany({
          where: { sourceKey: { startsWith: `payment:${sourceKey}:` } },
        });
        if (
          prior.length &&
          (prior.length !== allocations.length ||
            prior.some(
              (r) => !allocations.some((x) => x.billId === r.parentId),
            ))
        )
          fail("重复提交编号冲突");
        for (const item of [...allocations].sort((x, y) =>
          x.billId.localeCompare(y.billId),
        )) {
          await lock(tx, "incomes", item.billId);
          const bill = await this.access.get(a, "incomes", item.billId, tx);
          if (bill.orderId !== orderId) fail("只能收取本订单的款项");
          receipts.push(
            await this.register(
              tx,
              a,
              bill,
              {
                ...payment,
                amount: item.amount,
                sourceKey: `payment:${sourceKey}:${bill.id}`,
              },
              sourceKey,
              receipts[0]?.id,
            ),
          );
        }
        return { id: receipts[0].id, receipts };
      },
      { timeout: 15000 },
    );
  }
  async initial(tx: any, a: Actor, order: any) {
    const p = order.initialPayment;
    if (!p?.paid) return;
    if (!p.fundAccountId || !p.paymentMethod || !p.receivedOn)
      fail("已付款时请填写资金账户、付款方式和到账日期");
    const bills = await tx.income.findMany({
      where: {
        orderId: order.id,
        recordType: "RECEIVABLE",
        deletedAt: null,
        status: { not: "VOID" },
        sourceKey: {
          in: [
            `deposit:${order.id}`,
            `rent:${order.id}:${order.startsOn.toISOString().slice(0, 10)}`,
          ],
        },
      },
    });
    const group = randomUUID();
    let voucherIncomeId: string | undefined;
    for (const bill of bills) {
      const amount =
        p[bill.feeType === "DEPOSIT" ? "depositReceived" : "rentReceived"] ??
        "0";
      if (
        p.paymentState === "PAID" &&
        !number(amount).eq(number(bill.amount).add(bill.adjustmentAmount))
      )
        fail("实收金额与首期账单不一致，未付齐请选择部分付款");
      if (number(amount).lte(0)) continue;
      const r = await this.register(
        tx,
        a,
        bill,
        {
          amount,
          receivedOn: new Date(p.receivedOn),
          fundAccountId: p.fundAccountId,
          paymentMethod: p.paymentMethod,
          bankReference: p.bankReference,
          payerName: order.tenantName,
          sourceKey: `initial:${group}:${bill.id}`,
        },
        group,
        voucherIncomeId,
      );
      voucherIncomeId ??= r.id;
    }
  }
  async undo(a: Actor, key: string, body: any, reverse = false) {
    const { reason } = z
      .object({ reason: z.string().trim().min(1).max(500) })
      .strict()
      .parse(body);
    if (reverse) demand(financial(a));
    return this.db.$transaction(async (tx) => {
      const first = await this.access.get(a, "incomes", key, tx);
      if (first.recordType !== "RECEIPT" || !first.parentId)
        fail("只能处理收款记录");
      let parent = await tx.income.findUnique({
        where: { id: first.parentId },
      });
      if (parent?.orderId) await lock(tx, "orders", parent.orderId);
      await lock(tx, "incomes", first.parentId);
      await lock(tx, "incomes", key);
      parent = await tx.income.findUnique({ where: { id: first.parentId } });
      const r = await this.access.get(a, "incomes", key, tx);
      const target = reverse ? "REVERSED" : "WITHDRAWN";
      if (!reverse) demand(financial(a) || r.createdBy === a.id);
      if (r.status === target) return r;
      if (r.status !== (reverse ? "CONFIRMED" : "PENDING"))
        fail("收款状态已变化，请刷新后重试");
      if (
        reverse &&
        (await tx.expense.count({
          where: {
            originalIncomeId: key,
            deletedAt: null,
            status: { not: "VOID" },
          },
        }))
      )
        fail("该收款已有退款关联，不能冲正");
      if (reverse && parent?.orderId) {
        const o = await tx.order.findUnique({ where: { id: parent.orderId } });
        const expenses = await tx.expense.count({
          where: {
            orderId: parent.orderId,
            deletedAt: null,
            status: { not: "VOID" },
          },
        });
        if (
          o?.depositSettledAt ||
          expenses ||
          number(parent.depositOffsetAmount).gt(0)
        )
          fail("已有结算、抵扣或付款单，请先处理关联业务，不能冲正收款");
      }
      const result = await update(
        tx,
        "incomes",
        r,
        { status: target, rejectionReason: reason },
        a,
        reverse ? `收款冲正：${reason}` : `撤回登记：${reason}`,
      );
      if (reverse) {
        const invoices = await tx.invoice.findMany({
          where: { incomeId: key, status: "ACTIVE", deletedAt: null },
        });
        for (const inv of invoices)
          await update(
            tx,
            "invoices",
            inv,
            { status: "VOID", voidReason: reason },
            a,
            "收款冲正，作废收据",
          );
      }
      await this.refresh(tx, a, parent);
      return result;
    });
  }
  async refresh(tx: any, a: Actor, root: any) {
    const sums = await this.balances.totals(tx, root.id);
    await update(
      tx,
      "incomes",
      root,
      {
        status: sums.remaining.lte(0)
          ? "PAID"
          : sums.confirmed.add(sums.offset).gt(0)
            ? "PARTIAL"
            : "OPEN",
      },
      a,
      "更新收款进度",
    );
    if (!root.orderId) return;
    const o = await tx.order.findUnique({ where: { id: root.orderId } });
    if (!o || !["PENDING", "ACTIVE"].includes(o.status)) return;
    const initial = await tx.income.findMany({
      where: {
        orderId: o.id,
        recordType: "RECEIVABLE",
        deletedAt: null,
        status: { not: "VOID" },
        sourceKey: {
          in: [
            `deposit:${o.id}`,
            `rent:${o.id}:${o.startsOn.toISOString().slice(0, 10)}`,
          ],
        },
      },
    });
    let full = initial.length > 0;
    for (const bill of initial)
      if ((await this.balances.totals(tx, bill.id)).remaining.gt(0))
        full = false;
    // Receiving money never implies a physical move-in.
    await update(
      tx,
      "orders",
      o,
      { status: full ? "ACTIVE" : "PENDING" },
      a,
      "更新租赁生效状态",
    );
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
        await this.refresh(tx, a, root);
        return result;
      },
      { timeout: 15000 },
    );
  }
}

export const ReceiptInput = z
  .object({
    amount: money,
    receivedOn: date,
    fundAccountId: z.string().uuid(),
    paymentMethod: z.enum(["BANK", "CASH", "CHEQUE"]),
    bankReference: z.string().max(200).optional(),
    payerName: z.string().trim().min(1).max(500),
    remark: z.string().max(3000).optional(),
    sourceKey: z.string().uuid(),
  })
  .strict();
