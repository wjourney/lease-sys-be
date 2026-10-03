import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { dayAfter, plusMonths, rentPeriod } from "../../common/utils/rent-period";
import { number, plain, serial } from "../../common/utils/value";
import { date } from "../../common/validation/fields";
import { PrismaService } from "../../database/prisma.service";
import { RentBillingService } from "../incomes/rent-billing.service";
import { OrdersSchema } from "./dto/orders.schema";

function validateOrderDetails(d: any) {
  if (
    d.registrationNoType &&
    !(d.tenantType === "PERSON"
      ? ["HKID", "PASSPORT"].includes(d.registrationNoType)
      : ["BR", "CR"].includes(d.registrationNoType))
  )
    fail("注册号码类型与租客类型不一致");
  if (d.initialPayment && Object.keys(d.initialPayment).length) {
    const p = d.initialPayment;
    if (p.paid !== (p.rentPaid || p.depositPaid))
      fail("首期款状态与租金、押金付款状态不一致");
    if (
      (p.rentPaid && number(p.rentReceived).lte(0)) ||
      (p.depositPaid && number(p.depositReceived).lte(0)) ||
      (!p.rentPaid && number(p.rentReceived).gt(0)) ||
      (!p.depositPaid && number(p.depositReceived).gt(0))
    )
      fail("首期实收金额与付款状态不一致");
    if (p.paymentState === "UNPAID" && p.paid)
      fail("未付款时不能填报实收金额");
    if (p.paymentState === "PARTIAL" && !p.paid)
      fail("部分付款时请填写实收金额");
    if (
      p.paymentState === "PAID" &&
      (!p.rentPaid || (number(d.depositAmount).gt(0) && !p.depositPaid))
    )
      fail("已付款时请填写首期租金和押金的实收金额");
    if (p.paymentState && p.paymentState !== "UNPAID" && !p.receivedOn)
      fail("已付款时请填写到账日期");
  }
}
function validateDepositPlan(d: any) {
  const months = { ONE_ONE: 1, TWO_ONE: 2, THREE_ONE: 3 }[
    d.depositPlan as "ONE_ONE" | "TWO_ONE" | "THREE_ONE"
  ];
  if (months && !number(d.depositAmount).eq(number(d.monthlyRent).mul(months)))
    fail("押金金额与押付方式不一致，特殊金额请选择其他");
  if (
    months &&
    d.paymentIntervalMonths !== undefined &&
    d.paymentIntervalMonths !== 1
  )
    fail("押一付一等标准方案的付款频率应为每月");
}
@Injectable()
export class OrderLifecycleService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(RentBillingService) readonly billing: RentBillingService,
  ) {}
  private async saveOrderCommission(
    tx: any,
    a: Actor,
    order: any,
    commission: any,
    reason = "录入订单佣金",
  ) {
    if (!commission) return;
    const records = await tx.commission.findMany({
      where: { orderId: order.id, deletedAt: null },
      orderBy: { periodStart: "asc" },
    });
    const active = records.filter((record: any) => record.status !== "VOID");
    const first = active[0];
    const mode = commission.mode ?? first?.mode ?? "MONTHLY";
    const firstDueOn = commission.dueOn ?? first?.dueOn;
    const remark = commission.remark ?? first?.remark ?? null;
    const desired: any[] = [];
    if (mode === "RECURRING_MONTHLY") {
      if (!firstDueOn) fail("请填写首笔佣金结付日期");
      for (let month = 0; month < 600; month++) {
        const periodStart = plusMonths(order.startsOn, month);
        if (periodStart > order.endsOn) break;
        desired.push({
          mode,
          periodStart,
          periodEnd: new Date(
            Math.min(
              plusMonths(order.startsOn, month + 1).getTime() - 86400000,
              order.endsOn.getTime(),
            ),
          ),
          dueOn: plusMonths(firstDueOn, month),
          amount: commission.amount,
          remark,
        });
      }
      if (
        !desired.length ||
        plusMonths(order.startsOn, desired.length) <= order.endsOn
      )
        fail("佣金月结期数超出支持范围");
    } else {
      if (mode === "ONE_TIME" && !firstDueOn)
        fail("请填写佣金结付日期");
      desired.push({
        mode,
        periodStart:
          mode === "ONE_TIME"
            ? order.startsOn
            : commission.periodStart ?? first?.periodStart ?? order.startsOn,
        periodEnd:
          mode === "ONE_TIME"
            ? order.endsOn
            : commission.periodEnd ??
              first?.periodEnd ??
              new Date(
                Math.min(
                  plusMonths(order.startsOn, 1).getTime() - 86400000,
                  order.endsOn.getTime(),
                ),
              ),
        dueOn: firstDueOn ?? order.startsOn,
        amount: commission.amount,
        remark,
      });
    }
    if (desired.some((entry) => entry.periodStart > entry.periodEnd))
      fail("佣金结算结束不能早于开始");
    const key = (entry: any) =>
      `${entry.mode}:${entry.periodStart.toISOString().slice(0, 10)}`;
    const desiredByKey = new Map(desired.map((entry) => [key(entry), entry]));
    const same =
      active.length === desired.length &&
      active.every((record: any) => {
        const entry = desiredByKey.get(key(record));
        return (
          entry &&
          record.periodEnd.getTime() === entry.periodEnd.getTime() &&
          record.dueOn.getTime() === entry.dueOn.getTime() &&
          record.amount != null &&
          number(record.amount).eq(entry.amount) &&
          (record.remark ?? "") === (entry.remark ?? "")
        );
      });
    if (same) return;
    if (
      active.length &&
      (await tx.expense.count({
        where: {
          commissionId: { in: active.map((record: any) => record.id) },
          deletedAt: null,
          status: { in: ["UNPAID", "PAID"] },
        },
      }))
    )
      fail("佣金已有付款计划或付款记录，请在佣金管理中调整");
    const byKey = new Map(records.map((record: any) => [key(record), record]));
    for (const record of active) {
      if (desiredByKey.has(key(record))) continue;
      await lock(tx, "commissions", record.id);
      await update(tx, "commissions", record, { status: "VOID" }, a, reason);
    }
    for (const entry of desired) {
      const record: any = byKey.get(key(entry));
      if (record) {
        await lock(tx, "commissions", record.id);
        await update(
          tx,
          "commissions",
          record,
          { ...entry, status: "OPEN" },
          a,
          reason,
        );
      } else {
        await insert(
          tx,
          "commissions",
          {
            ...entry,
            orderId: order.id,
            salesCompanyId: order.salesCompanyId,
            salesUserId: order.salesUserId,
            commissionNo: serial("CM"),
            status: "OPEN",
          },
          a,
        );
      }
    }
  }
  async createOrder(a: Actor, body: any) {
    this.access.allow(a, "orders", true);
    const d = OrdersSchema.strict().parse(body);
    const { commission, ...orderData } = d;
    if (d.startsOn > d.endsOn) fail("租期开始日期不能晚于结束日期");
    if (number(d.monthlyRent).lte(0)) fail("租金必须大于零");
    if (!commission || number(commission.amount).lte(0))
      fail("请填写大于零的佣金金额");
    validateDepositPlan(d);
    validateOrderDetails(d);
    return this.db.$transaction(
      async (tx) => {
        await lock(tx, "units", d.unitId);
        const u = await this.access.get(a, "units", d.unitId, tx);
        if (!u.enabled) fail("单位已停用");
        const project = await tx.project.findUnique({
          where: { id: u.projectId },
        });
        if (!project || project.status !== "ACTIVE" || project.deletedAt)
          fail("项目已停用");
        const sales = await tx.user.findFirst({
          where: {
            id: d.salesUserId,
            deletedAt: null,
            status: "ACTIVE",
            role: { in: ["SALES", "SALES_COMPANY_ADMIN"] },
          },
        });
        if (!sales?.salesCompanyId)
          throw new ConflictException("请选择有效的销售账号");
        if (!internal(a)) {
          demand(sales.salesCompanyId === a.salesCompanyId);
          if (a.role === "SALES") demand(sales.id === a.id);
        }
        const company = await tx.salesCompany.findUnique({
          where: { id: sales.salesCompanyId },
        });
        if (
          !company ||
          company.status !== "ACTIVE" ||
          company.deletedAt ||
          (company.serviceEndsOn &&
            company.serviceEndsOn.getTime() + 86400000 < Date.now())
        )
          fail("销售公司服务已到期或停用");
        await this.checkOccupancy(tx, u.id, d.startsOn, d.endsOn);
        if (
          plusMonths(d.startsOn, u.minLeaseMonths).getTime() - 86400000 >
          d.endsOn.getTime()
        )
          fail("租期未达到单位最短租期");
        let o = await insert(
          tx,
          "orders",
          {
            ...orderData,
            projectId: u.projectId,
            salesCompanyId: sales.salesCompanyId,
            orderNo: serial("R"),
            tenantSnapshot: {
              name: d.tenantName,
              phone: d.tenantPhone,
              email: d.tenantEmail,
            },
            unitSnapshot: plain({
              unitNo: u.unitNo,
              area: u.area,
              layout: u.layout,
              projectName: project!.name,
            }),
            salesSnapshot: {
              name: sales.name,
              companyId: sales.salesCompanyId,
            },
            status: "PENDING",
            occupancyState: "LOCKED",
          },
          a,
        );
        if (number(o.depositAmount).gt(0))
          await insert(
            tx,
            "incomes",
            {
              recordNo: serial("B"),
              recordType: "RECEIVABLE",
              orderId: o.id,
              projectId: o.projectId,
              unitId: o.unitId,
              feeType: "DEPOSIT",
              amount: o.depositAmount,
              dueOn: o.startsOn,
              payerName: o.tenantName,
              payerEmail: o.tenantEmail,
              status: "OPEN",
              sourceKey: `deposit:${o.id}`,
            },
            a,
          );
        const b = await this.billing.bill(tx, o, o.startsOn, a);
        o = await update(
          tx,
          "orders",
          o,
          { nextBillOn: b.next <= o.endsOn ? b.next : null },
          a,
          "生成首期应收",
        );
        await this.saveOrderCommission(tx, a, o, commission);
        return o;
      },
      { timeout: 15000 },
    );
  }
  async checkOccupancy(
    tx: any,
    unitId: string,
    start: Date,
    end: Date,
    exclude?: string,
  ) {
    const collision = await tx.order.findFirst({
      where: {
        unitId,
        deletedAt: null,
        id: exclude ? { not: exclude } : undefined,
        status: { not: "CLOSED" },
        occupancyState: { not: "RELEASED" },
        OR: [
          { startsOn: { lte: end }, endsOn: { gte: start } },
          {
            status: { in: ["ACTIVE", "COMPLETED"] },
            endsOn: {
              lt: new Date(
                Math.min(
                  start.getTime(),
                  new Date(new Date().toISOString().slice(0, 10)).getTime(),
                ),
              ),
            },
            handoverStatus: { not: "DONE" },
          },
        ],
      },
    });
    if (collision)
      throw new ConflictException(
        "该单位在所选租期已被占用，或前一租客尚未交还",
      );
  }
  async editOrder(a: Actor, key: string, body: any) {
    this.access.allow(a, "orders", true);
    const { revision, reason, ...rest } = z
      .object({ revision: z.number().int(), reason: z.string().min(1) })
      .passthrough()
      .parse(body);
    const d = OrdersSchema.omit({ unitId: true, salesUserId: true })
      .extend({
        registrationNoType: OrdersSchema.shape.registrationNoType.nullable(),
        depositPlan: OrdersSchema.shape.depositPlan.nullable(),
        moveInOn: OrdersSchema.shape.moveInOn.nullable(),
      })
      .partial()
      .strict()
      .parse(rest);
    const { commission, ...changes } = d;
    return this.db.$transaction(async (tx) => {
      let o = await this.access.get(a, "orders", key, tx);
      await lock(tx, "units", o.unitId);
      await lock(tx, "orders", key);
      o = await this.access.get(a, "orders", key, tx);
      if (o.revision !== revision)
        throw new ConflictException("订单已更新，请刷新");
      if (o.status === "CLOSED") fail("已关闭订单不能修改");
      const hasReceipts = !!(await tx.income.count({
        where: {
          orderId: key,
          recordType: "RECEIPT",
          deletedAt: null,
          status: { in: ["PENDING", "CONFIRMED"] },
        },
      }));
      if (o.status !== "PENDING" || o.firstPaymentRegisteredAt || hasReceipts) {
        const allowed = new Set([
          "tenantPhone",
          "tenantEmail",
          "tenantContactName",
          "remark",
        ]);
        if (Object.keys(changes).some((field) => !allowed.has(field)))
          fail("已有收款或租期已生效，仅能修改联系方式和备注");
        await this.saveOrderCommission(tx, a, o, commission, reason);
        return update(
          tx,
          "orders",
          o,
          {
            ...changes,
            ...(changes.tenantPhone !== undefined ||
            changes.tenantEmail !== undefined
              ? {
                  tenantSnapshot: {
                    name: o.tenantName,
                    phone: changes.tenantPhone ?? o.tenantPhone,
                    email: changes.tenantEmail ?? o.tenantEmail,
                  },
                }
              : {}),
          },
          a,
          reason,
        );
      }
      const next = { ...o, ...changes };
      if (next.startsOn > next.endsOn) fail("租期无效");
      if (number(next.monthlyRent).lte(0)) fail("租金必须大于零");
      if (commission && number(commission.amount).lte(0))
        fail("佣金金额必须大于零");
      if (["monthlyRent", "depositAmount", "depositPlan", "paymentIntervalMonths"].some((key) => key in changes))
        validateDepositPlan(next);
      const unit = await this.access.get(a, "units", o.unitId, tx);
      if (
        plusMonths(next.startsOn, unit.minLeaseMonths).getTime() - 86400000 >
        next.endsOn.getTime()
      )
        fail("租期未达到单位最短租期");
      validateOrderDetails(next);
      const oldBills = await tx.income.findMany({
        where: { orderId: key, recordType: "RECEIVABLE", deletedAt: null },
      });
      if (
        await tx.income.count({
          where: {
            parentId: { in: oldBills.map((x) => x.id) },
            deletedAt: null,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
        })
      )
        fail("已有收款，不能直接修改租约");
      for (const bill of oldBills.filter(
        (x) =>
          x.sourceKey?.startsWith(`rent:${key}:`) ||
          x.sourceKey === `deposit:${key}`,
      )) {
        await lock(tx, "incomes", bill.id);
        await update(
          tx,
          "incomes",
          bill,
          { status: "VOID", sourceKey: null },
          a,
          "修改租约，重建未收款账单",
        );
      }
      if (number(next.depositAmount).gt(0))
        await insert(
          tx,
          "incomes",
          {
            recordNo: serial("B"),
            recordType: "RECEIVABLE",
            orderId: key,
            projectId: o.projectId,
            unitId: o.unitId,
            feeType: "DEPOSIT",
            amount: next.depositAmount,
            currency: o.currency,
            dueOn: next.startsOn,
            payerName: next.tenantName,
            payerEmail: next.tenantEmail,
            status: "OPEN",
            sourceKey: `deposit:${key}`,
          },
          a,
        );
      const bill = await this.billing.bill(tx, next, next.startsOn, a);

      await this.checkOccupancy(tx, o.unitId, next.startsOn, next.endsOn, o.id);
      const tenantChanged =
        changes.tenantName !== undefined ||
        changes.tenantPhone !== undefined ||
        changes.tenantEmail !== undefined;
      await this.saveOrderCommission(tx, a, next, commission, reason);
      return update(
        tx,
        "orders",
        o,
        {
          ...changes,
          nextBillOn: bill.next <= next.endsOn ? bill.next : null,
          ...(tenantChanged
            ? {
                tenantSnapshot: {
                  name: next.tenantName,
                  phone: next.tenantPhone,
                  email: next.tenantEmail,
                },
              }
            : {}),
        },
        a,
        reason,
      );
    });
  }
  async terminate(a: Actor, key: string, body: any) {
    demand(["SUPER_ADMIN", "OPERATIONS"].includes(a.role));
    const d = z
      .object({ date, reason: z.string().min(1) })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "orders", key);
      const o = await this.access.get(a, "orders", key, tx);
      if (o.status !== "ACTIVE") fail("仅生效中的订单可退租");
      if (d.date < o.startsOn || d.date > o.endsOn)
        fail("退租日期必须在租期内");
      // Recalculate only generated rent periods. Confirmed receipts are immutable.
      const bills = await tx.income.findMany({
        where: {
          orderId: key,
          recordType: "RECEIVABLE",
          feeType: "RENT",
          sourceKey: { startsWith: `rent:${key}:` },
          deletedAt: null,
          status: { not: "VOID" },
        },
        orderBy: { periodStart: "asc" },
      });
      for (const bill of bills) {
        if (!bill.periodStart || !bill.periodEnd || bill.periodEnd <= d.date)
          continue;
        await lock(tx, "incomes", bill.id);
        const receipts = await tx.income.findMany({
          where: {
            parentId: bill.id,
            deletedAt: null,
            status: { in: ["CONFIRMED", "PENDING"] },
          },
        });
        if (receipts.some((x) => x.status === "PENDING"))
          fail("末期账单有待确认收款，请先处理再退租");
        const received = receipts.reduce((n, x) => n.add(x.amount), number(0));
        const total =
          bill.periodStart > d.date
            ? number(0)
            : rentPeriod({ ...o, endsOn: d.date }, bill.periodStart).amount;
        const overpaid = received.sub(total);
        // Keep a fully received bill balanced and issue the excess as a separate refund.
        const receivable = overpaid.gt(0) ? received : total;
        await update(
          tx,
          "incomes",
          bill,
          {
            adjustmentAmount: receivable.sub(bill.amount),
            periodEnd: bill.periodStart > d.date ? bill.periodEnd : d.date,
            status: receivable.eq(0)
              ? "VOID"
              : receivable.eq(received)
                ? "PAID"
                : received.gt(0)
                  ? "PARTIAL"
                  : "OPEN",
          },
          a,
          `退租末期核算：${d.reason}`,
        );
        if (overpaid.gt(0))
          await insert(
            tx,
            "expenses",
            {
              expenseNo: serial("E"),
              orderId: key,
              projectId: o.projectId,
              unitId: o.unitId,
              feeType: "RENT_REFUND",
              amount: overpaid,
              currency: o.currency,
              payeeName: o.tenantName,
              dueOn: d.date,
              sourceKey: `rent-refund:${bill.id}`,
              remark: `退租租金退还：${d.reason}`,
            },
            a,
          );
      }
      const latest = bills[bills.length - 1];
      if (latest?.periodEnd && dayAfter(latest.periodEnd) <= d.date) {
        let start = dayAfter(latest.periodEnd);
        while (start <= d.date) {
          const bill = await this.billing.bill(
            tx,
            { ...o, endsOn: d.date },
            start,
            a,
          );
          start = bill.next;
        }
      }
      return update(
        tx,
        "orders",
        o,
        { status: "COMPLETED", actualTerminationOn: d.date, nextBillOn: null },
        a,
        d.reason,
      );
    });
  }
  async handover(a: Actor, key: string, body: any) {
    demand(["SUPER_ADMIN", "OPERATIONS"].includes(a.role));
    const d = z
      .object({ note: z.string().trim().min(1), date: date.optional() })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      const current = await this.access.get(a, "orders", key, tx);
      await lock(tx, "units", current.unitId);
      await lock(tx, "orders", key);
      const o = await this.access.get(a, "orders", key, tx);
      if (o.status !== "COMPLETED") fail("先完成退租再登记交还");
      if (o.handoverStatus === "DONE") return o;
      if (d.date && d.date < (o.actualTerminationOn ?? o.endsOn))
        fail("交还日期不能早于退租日期");
      return update(
        tx,
        "orders",
        o,
        {
          handoverStatus: "DONE",
          handedOverAt: d.date ?? new Date(),
          handoverNote: d.note,
          occupancyState: "RELEASED",
        },
        a,
        d.note,
      );
    });
  }
  async close(a: Actor, key: string) {
    this.access.allow(a, "orders", true);
    return this.db.$transaction(async (tx) => {
      const o = await this.access.get(a, "orders", key, tx);
      await lock(tx, "units", o.unitId);
      await lock(tx, "orders", key);
      const fresh = await this.access.get(a, "orders", key, tx);
      if (fresh.status !== "PENDING" || fresh.firstPaymentRegisteredAt)
        fail("仅未登记收款的待确认订单可关闭");
      const roots = await tx.income.findMany({
        where: { orderId: key, recordType: "RECEIVABLE" },
      });
      if (
        await tx.income.count({
          where: {
            parentId: { in: roots.map((x) => x.id) },
            deletedAt: null,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
        })
      )
        fail("已有收款，不能直接关闭订单");
      for (const r of roots)
        await update(tx, "incomes", r, { status: "VOID" }, a, "关闭订单");
      return update(
        tx,
        "orders",
        fresh,
        { status: "CLOSED", occupancyState: "RELEASED", nextBillOn: null },
        a,
        "关闭订单",
      );
    });
  }
}
