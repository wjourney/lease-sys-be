import { orderInProgress } from "../../common/utils/order-status";
import { ReceiptsService } from "../incomes/receipts.service";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import {
  dayAfter,
  plusMonths,
  rentPeriod,
} from "../../common/utils/rent-period";
import { number, plain, serial } from "../../common/utils/value";
import { date, money } from "../../common/validation/fields";
import { PrismaService } from "../../database/prisma.service";
import { RentBillingService } from "../incomes/rent-billing.service";
import { OrdersSchema } from "./dto/orders.schema";
import { defaultInitialAccount } from "../fund-accounts/default-platform-account";

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
    if (p.paymentState === "UNPAID" && p.paid) fail("未付款时不能填报实收金额");
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
    @Inject(ReceiptsService) readonly receipts: ReceiptsService,
  ) {}
  private async saveOrderCommission(
    tx: any,
    a: Actor,
    order: any,
    commission: any,
    reason = "录入订单佣金",
  ) {
    if (!commission || !order.salesCompanyId || !order.salesUserId) return;
    const records = await tx.commission.findMany({
      where: { orderId: order.id, deletedAt: null },
      orderBy: { periodStart: "asc" },
    });
    const active = records.filter((record: any) => record.status !== "VOID");
    const first = active[0];
    // Omitted optional fields preserve an existing agreement; incomplete new
    // agreements remain on the order until they can produce payable records.
    commission = {
      ...first,
      ...Object.fromEntries(
        Object.entries(commission).filter(([, value]) => value != null),
      ),
    };
    if (!commission.mode || !commission.dueOn || commission.amount == null)
      return;
    if (!number(commission.amount).gt(0)) fail("佣金金额必须大于零");
    commission = {
      ...commission,
      dueOn:
        commission.dueOn instanceof Date
          ? commission.dueOn
          : date.parse(commission.dueOn.slice(0, 10)),
    };
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
      if (mode === "ONE_TIME" && !firstDueOn) fail("请填写佣金结付日期");
      desired.push({
        mode,
        periodStart:
          mode === "ONE_TIME"
            ? order.startsOn
            : (commission.periodStart ?? first?.periodStart ?? order.startsOn),
        periodEnd:
          mode === "ONE_TIME"
            ? order.endsOn
            : (commission.periodEnd ??
              first?.periodEnd ??
              new Date(
                Math.min(
                  plusMonths(order.startsOn, 1).getTime() - 86400000,
                  order.endsOn.getTime(),
                ),
              )),
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
          status: { not: "VOID" },
        },
      }))
    )
      fail("佣金已有付款计划或付款记录，不能直接修改佣金约定");
    const byKey = new Map(active.map((record: any) => [key(record), record]));
    for (const record of active) {
      if (desiredByKey.has(key(record))) continue;
      await lock(tx, "commissions", record.id);
      await update(tx, "commissions", record, { status: "VOID" }, a, reason);
    }
    for (const entry of desired) {
      const record: any = byKey.get(key(entry));
      if (record) {
        if (
          record.periodEnd.getTime() === entry.periodEnd.getTime() &&
          record.dueOn.getTime() === entry.dueOn.getTime() &&
          number(record.amount).eq(entry.amount) &&
          (record.remark ?? "") === (entry.remark ?? "")
        )
          continue;
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
    return this.saveDraftOrNew(a, body);
  }
  private async saveDraftOrNew(a: Actor, body: any, draftId?: string) {
    this.access.allow(a, "orders", true);
    const { revision, reason, ...input } = body;
    const parsed = (draftId ? OrdersSchema.partial() : OrdersSchema)
      .strict()
      .parse(input);
    if (!draftId && (!parsed.projectId || !parsed.unitId))
      fail("请选择项目和单位");
    return this.db.$transaction(
      async (tx) => {
        let draft: any;
        if (draftId) {
          const before = await this.access.get(a, "orders", draftId, tx);
          if (parsed.unitId || before.unitId)
            await lock(tx, "units", parsed.unitId || before.unitId);
          await lock(tx, "orders", draftId);
          draft = await this.access.get(a, "orders", draftId, tx);
          if (draft.status !== "DRAFT" || draft.revision !== revision)
            throw new ConflictException("订单已更新，请刷新");
        }
        const d: any = {
          tenantType: "COMPANY",
          depositPlan: "ONE_ONE",
          paymentIntervalMonths: 1,
          firstPeriodProration: true,
          lastPeriodProration: true,
          ...draft,
          ...parsed,
        };
        d.depositPlan ??= "ONE_ONE";
        d.startsOn ??= new Date(new Date().toISOString().slice(0, 10));
        d.endsOn ??= new Date(plusMonths(d.startsOn, 12).getTime() - 86400000);
        d.rentDueDay ??= d.startsOn.getUTCDate();
        d.paymentIntervalMonths = 1;
        if (d.startsOn > d.endsOn || d.endsOn >= plusMonths(d.startsOn, 600))
          fail("请检查租期范围（最多 600 个月）");
        let unit: any = null,
          project: any = null,
          sales: any = null;
        if (d.unitId) {
          await lock(tx, "units", d.unitId);
          unit = await this.access.get(a, "units", d.unitId, tx);
          project = await this.access.get(a, "projects", unit.projectId, tx);
          if (d.projectId && d.projectId !== unit.projectId)
            fail("单位不属于所选项目");
          if (!unit.enabled || project.status !== "ACTIVE")
            fail("项目或单位已停用");
          d.projectId = unit.projectId;
          d.monthlyRent ??= unit.referenceRent?.toString();
        } else if (d.projectId)
          project = await this.access.get(a, "projects", d.projectId, tx);
        if (!draftId && !number(d.monthlyRent).gt(0))
          fail("请填写大于零的月租");
        if (d.salesUserId) {
          sales = await tx.user.findFirst({
            where: {
              id: d.salesUserId,
              deletedAt: null,
              status: "ACTIVE",
              role: { in: ["SALES", "SALES_COMPANY_ADMIN"] },
            },
          });
          if (!sales?.salesCompanyId) fail("请选择有效的销售账号");
          if (d.salesCompanyId && d.salesCompanyId !== sales!.salesCompanyId)
            fail("销售员工不属于所选公司");
          d.salesCompanyId = sales!.salesCompanyId!;
        }
        if (d.salesCompanyId) {
          const company = await this.access.get(
            a,
            "sales-companies",
            d.salesCompanyId,
            tx,
          );
          if (
            company.serviceEndsOn &&
            company.serviceEndsOn.getTime() + 86400000 < Date.now()
          )
            fail("销售公司服务已到期");
        }
        const months =
          { ONE_ONE: 1, TWO_ONE: 2, THREE_ONE: 3 }[d.depositPlan as string] ??
          1;
        d.depositAmount ??=
          d.monthlyRent != null
            ? number(d.monthlyRent).mul(months).toFixed(2)
            : null;
        const ready = !!unit && number(d.monthlyRent).gt(0);
        if (ready) {
          await this.checkOccupancy(tx, unit.id, d.startsOn, d.endsOn, draftId);
          if (
            plusMonths(d.startsOn, unit.minLeaseMonths).getTime() - 86400000 >
            d.endsOn.getTime()
          )
            fail("租期未达到单位最短租期");
          validateDepositPlan(d);
        }
        const suppliedCommission = parsed.commission ?? draft?.commissionDraft;
        // New orders and completed drafts always use monthly installments.
        // Existing signed agreements retain their mode in editOrder.
        const commission = suppliedCommission
          ? { ...suppliedCommission, mode: "RECURRING_MONTHLY" }
          : undefined;
        const payment: any = d.initialPayment ?? {
          paid: false,
          rentPaid: false,
          depositPaid: false,
          rentReceived: "0",
          depositReceived: "0",
        };
        if (payment.paid && !ready) fail("请先补充单位和月租，再登记实际收款");
        if (payment.paid) {
          payment.receivedOn ??= new Date().toISOString().slice(0, 10);
          payment.paymentMethod ??= "BANK";
          await defaultInitialAccount(tx, payment);
        }
        validateOrderDetails({ ...d, initialPayment: payment });
        const fields: any = {};
        for (const key of Object.keys(OrdersSchema.shape))
          if (key !== "commission" && d[key] !== undefined)
            fields[key] = d[key];
        Object.assign(fields, {
          projectId: d.projectId ?? null,
          unitId: d.unitId ?? null,
          salesCompanyId: d.salesCompanyId ?? null,
          salesUserId: d.salesUserId ?? null,
          monthlyRent: d.monthlyRent ?? null,
          depositAmount: d.depositAmount,
          initialPayment: plain(payment),
          commissionDraft: plain(commission ?? {}),
          billingVersion: 2,
          status: ready ? "ACTIVE" : "DRAFT",
          occupancyState: ready ? "OCCUPIED" : "RELEASED",
          nextBillOn: null,
          tenantSnapshot: plain({
            name: d.tenantName,
            phone: d.tenantPhone,
            email: d.tenantEmail,
          }),
          unitSnapshot: unit
            ? plain({
                unitNo: unit.unitNo,
                area: unit.area,
                layout: unit.layout,
                projectName: project.name,
              })
            : {},
          salesSnapshot: sales
            ? { name: sales.name, companyId: sales.salesCompanyId }
            : {},
        });
        const order = draft
          ? await update(
              tx,
              "orders",
              draft,
              fields,
              a,
              reason || "完善订单资料",
            )
          : await insert(tx, "orders", { ...fields, orderNo: serial("R") }, a);
        if (ready) {
          if (number(order.depositAmount).gt(0))
            await insert(
              tx,
              "incomes",
              {
                recordNo: serial("B"),
                recordType: "RECEIVABLE",
                orderId: order.id,
                projectId: order.projectId,
                unitId: order.unitId,
                feeType: "DEPOSIT",
                amount: order.depositAmount,
                currency: "HKD",
                dueOn: order.startsOn,
                payerName: order.tenantName,
                payerEmail: order.tenantEmail,
                status: "OPEN",
                sourceKey: `deposit:${order.id}`,
              },
              a,
            );
          await this.billing.fullTerm(tx, order, a);
          await this.saveOrderCommission(tx, a, order, commission);
          await this.receipts.initial(tx, a, order);
        }
        return tx.order.findUniqueOrThrow({ where: { id: order.id } });
      },
      { timeout: 30000 },
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
            status: { in: ["PENDING", "ACTIVE", "COMPLETED"] },
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
    const current = await this.access.get(a, "orders", key);
    if (current.status === "DRAFT") return this.saveDraftOrNew(a, body, key);
    const { revision, reason, ...rest } = z
      .object({
        revision: z.number().int(),
        reason: z.string().default("修改订单资料"),
      })
      .passthrough()
      .parse(body);
    const d = OrdersSchema.omit({ unitId: true, projectId: true })
      .extend({
        registrationNoType: OrdersSchema.shape.registrationNoType.nullable(),
        depositPlan: OrdersSchema.shape.depositPlan.nullable(),
        moveInOn: OrdersSchema.shape.moveInOn.nullable(),
      })
      .partial()
      .strict()
      .parse(rest);
    const { commission: submittedCommission, ...changes } = d;
    return this.db.$transaction(
      async (tx) => {
        let commission: any = submittedCommission;
        let o = await this.access.get(a, "orders", key, tx);
        await lock(tx, "units", o.unitId);
        await lock(tx, "orders", key);
        o = await this.access.get(a, "orders", key, tx);
        if (o.revision !== revision)
          throw new ConflictException("订单已更新，请刷新");
        if (o.status === "CLOSED") fail("已关闭订单不能修改");
        if (
          o.salesUserId &&
          ((changes.salesUserId && changes.salesUserId !== o.salesUserId) ||
            (changes.salesCompanyId &&
              changes.salesCompanyId !== o.salesCompanyId))
        )
          fail("已有销售归属的订单不能直接更换销售");
        await defaultInitialAccount(tx, changes.initialPayment, o.currency);
        if (!commission) {
          const existing = await tx.commission.findMany({
            where: { orderId: key, deletedAt: null, status: { not: "VOID" } },
            orderBy: { periodStart: "asc" },
          });
          if (
            (changes.startsOn &&
              changes.startsOn.getTime() !== o.startsOn.getTime()) ||
            (changes.endsOn && changes.endsOn.getTime() !== o.endsOn.getTime())
          ) {
            const first = existing[0];
            if (first && ["ONE_TIME", "RECURRING_MONTHLY"].includes(first.mode))
              commission = {
                mode: first.mode as "ONE_TIME" | "RECURRING_MONTHLY",
                dueOn: first.dueOn!,
                amount: first.amount!.toString(),
                remark: first.remark ?? undefined,
              };
          }
        }
        commission ??= o.commissionDraft;
        const billIds = await tx.income.findMany({
          where: { orderId: key, recordType: "RECEIVABLE", deletedAt: null },
          select: { id: true },
        });
        const hasReceipts = !!(await tx.income.count({
          where: {
            parentId: { in: billIds.map((x) => x.id) },
            recordType: "RECEIPT",
            deletedAt: null,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
        }));
        if (!orderInProgress(o.status) || hasReceipts) {
          const allowed = new Set([
            "tenantPhone",
            "tenantEmail",
            "tenantContactName",
            "remark",
          ]);
          if (!o.salesUserId && changes.salesUserId) {
            const sales = await tx.user.findFirst({
              where: {
                id: changes.salesUserId,
                deletedAt: null,
                status: "ACTIVE",
                role: { in: ["SALES", "SALES_COMPANY_ADMIN"] },
              },
            });
            if (!sales?.salesCompanyId) fail("请选择有效的销售账号");
            changes.salesCompanyId = sales!.salesCompanyId!;
            allowed.add("salesUserId");
            allowed.add("salesCompanyId");
          }
          if (Object.keys(changes).some((field) => !allowed.has(field)))
            fail("已有收款或租期已生效，仅能修改联系方式和备注");
          await this.saveOrderCommission(
            tx,
            a,
            { ...o, ...changes },
            commission,
            reason,
          );
          return update(
            tx,
            "orders",
            o,
            {
              ...changes,
              ...(submittedCommission
                ? { commissionDraft: plain(submittedCommission) }
                : {}),
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
        if (changes.salesUserId) {
          const sales = await tx.user.findFirst({
            where: {
              id: changes.salesUserId,
              deletedAt: null,
              status: "ACTIVE",
              role: { in: ["SALES", "SALES_COMPANY_ADMIN"] },
            },
          });
          if (!sales?.salesCompanyId) fail("请选择有效的销售账号");
          if (
            changes.salesCompanyId &&
            changes.salesCompanyId !== sales!.salesCompanyId
          )
            fail("销售员工不属于所选公司");
          changes.salesCompanyId = sales!.salesCompanyId!;
        }
        if (changes.salesCompanyId)
          await this.access.get(
            a,
            "sales-companies",
            changes.salesCompanyId,
            tx,
          );
        const next = { ...o, ...changes };
        if (o.billingVersion === 2 && next.paymentIntervalMonths !== 1)
          fail("新订单按月生成账单，付款频率应为每月");
        if (next.endsOn >= plusMonths(next.startsOn, 600))
          fail("租期最多支持 600 个月");
        if (next.startsOn > next.endsOn) fail("租期无效");
        if (number(next.monthlyRent).lte(0)) fail("租金必须大于零");
        if (commission?.amount != null && number(commission.amount).lte(0))
          fail("佣金金额必须大于零");
        if (
          [
            "monthlyRent",
            "depositAmount",
            "depositPlan",
            "paymentIntervalMonths",
          ].some((key) => key in changes)
        )
          validateDepositPlan(next);
        const unit = await this.access.get(a, "units", o.unitId, tx);
        if (
          plusMonths(next.startsOn, unit.minLeaseMonths).getTime() - 86400000 >
          next.endsOn.getTime()
        )
          fail("租期未达到单位最短租期");
        validateOrderDetails(next);
        const rentChanged =
          [
            "startsOn",
            "endsOn",
            "paymentIntervalMonths",
            "rentDueDay",
            "firstPeriodProration",
            "lastPeriodProration",
          ].some(
            (field) =>
              JSON.stringify(plain((o as any)[field])) !==
              JSON.stringify(plain((next as any)[field])),
          ) || !number(o.monthlyRent).eq(next.monthlyRent);
        const depositChanged =
          !number(o.depositAmount).eq(next.depositAmount) ||
          o.startsOn.getTime() !== next.startsOn.getTime();
        let nextBillOn = o.nextBillOn;
        if (rentChanged || depositChanged) {
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
              (rentChanged && x.sourceKey?.startsWith(`rent:${key}:`)) ||
              (depositChanged && x.sourceKey === `deposit:${key}`),
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
          if (depositChanged && number(next.depositAmount).gt(0))
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
          if (rentChanged) {
            await this.billing.fullTerm(tx, next, a);
            nextBillOn = null;
          }
        }

        await this.checkOccupancy(
          tx,
          o.unitId,
          next.startsOn,
          next.endsOn,
          o.id,
        );
        const tenantChanged =
          changes.tenantName !== undefined ||
          changes.tenantPhone !== undefined ||
          changes.tenantEmail !== undefined;
        await this.saveOrderCommission(tx, a, next, commission, reason);
        const saved = await update(
          tx,
          "orders",
          o,
          {
            ...changes,
            ...(submittedCommission
              ? { commissionDraft: plain(submittedCommission) }
              : {}),
            nextBillOn,
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
        if (changes.initialPayment) await this.receipts.initial(tx, a, saved);
        return saved;
      },
      { timeout: 30000 },
    );
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
      if (!orderInProgress(o.status)) fail("仅进行中的订单可退租");
      if (d.date > o.endsOn) fail("退租日期不能晚于租期结束日期");
      if (d.date < o.startsOn && o.moveInOn) fail("已登记入住的订单不能按起租前取消处理");
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
  async moveIn(a: Actor, key: string, body: any) {
    demand(["SUPER_ADMIN", "OPERATIONS"].includes(a.role));
    const d = z
      .object({ date, reason: z.string().trim().min(1) })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      const first = await this.access.get(a, "orders", key, tx);
      await lock(tx, "units", first.unitId);
      await lock(tx, "orders", key);
      const o = await this.access.get(a, "orders", key, tx);
      if (!orderInProgress(o.status)) fail("仅进行中的订单可办理入住");
      if (d.date > new Date() || d.date < o.startsOn || d.date > o.endsOn)
        fail("入住日期应在租期内，且不能晚于今天");
      return update(
        tx,
        "orders",
        o,
        { moveInOn: d.date, occupancyState: "OCCUPIED" },
        a,
        d.reason,
      );
    });
  }
  async fee(a: Actor, key: string, body: any) {
    demand(["SUPER_ADMIN", "OPERATIONS"].includes(a.role));
    const d = z
      .object({
        amount: money,
        dueOn: date,
        remark: z.string().trim().min(1).max(500),
        sourceKey: z.string().uuid(),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "orders", key);
      const o = await this.access.get(a, "orders", key, tx);
      if (o.status === "CLOSED" || number(d.amount).lte(0))
        fail("当前订单不可新增该费用");
      const sourceKey = `fee:${key}:${d.sourceKey}`;
      const existing = await tx.income.findUnique({ where: { sourceKey } });
      if (existing) {
        if (
          !number(existing.amount).eq(d.amount) ||
          existing.remark !== d.remark ||
          existing.dueOn?.getTime() !== d.dueOn.getTime()
        )
          fail("重复提交编号冲突");
        return existing;
      }
      return insert(
        tx,
        "incomes",
        {
          ...d,
          sourceKey,
          recordNo: serial("B"),
          recordType: "RECEIVABLE",
          orderId: key,
          projectId: o.projectId,
          unitId: o.unitId,
          feeType: "OTHER",
          currency: o.currency,
          payerName: o.tenantName,
          payerEmail: o.tenantEmail,
          status: "OPEN",
        },
        a,
      );
    });
  }
  async voidFee(a: Actor, key: string, billId: string, body: any) {
    demand(["SUPER_ADMIN", "OPERATIONS"].includes(a.role));
    const { reason } = z
      .object({ reason: z.string().trim().min(1).max(500) })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await this.access.get(a, "orders", key, tx);
      await lock(tx, "orders", key);
      await lock(tx, "incomes", billId);
      const bill = await this.access.get(a, "incomes", billId, tx);
      if (
        bill.orderId !== key ||
        bill.recordType !== "RECEIVABLE" ||
        bill.feeType !== "OTHER"
      )
        fail("只能作废本订单的其他费用");
      if (
        number(bill.depositOffsetAmount).gt(0) ||
        (await tx.income.count({
          where: {
            parentId: billId,
            deletedAt: null,
            status: { in: ["PENDING", "CONFIRMED"] },
          },
        }))
      )
        fail("已有收款或抵扣，不能作废");
      if (bill.status === "VOID") return bill;
      return update(
        tx,
        "incomes",
        bill,
        { status: "VOID", nextGenerationOn: null },
        a,
        reason,
      );
    });
  }
  async voidCommission(a: Actor, key: string, commissionId: string, body: any) {
    demand(["SUPER_ADMIN", "OPERATIONS"].includes(a.role));
    const { reason } = z
      .object({ reason: z.string().trim().min(1).max(500) })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await this.access.get(a, "orders", key, tx);
      await lock(tx, "orders", key);
      await lock(tx, "commissions", commissionId);
      const c = await tx.commission.findFirst({
        where: { id: commissionId, orderId: key, deletedAt: null },
      });
      if (!c) fail("佣金不存在");
      if (
        await tx.expense.count({
          where: { commissionId, deletedAt: null, status: { not: "VOID" } },
        })
      )
        fail("已有付款单，不能作废佣金");
      return c!.status === "VOID"
        ? c
        : update(tx, "commissions", c, { status: "VOID" }, a, reason);
    });
  }
  async close(a: Actor, key: string) {
    this.access.allow(a, "orders", true);
    return this.db.$transaction(async (tx) => {
      const o = await this.access.get(a, "orders", key, tx);
      await lock(tx, "units", o.unitId);
      await lock(tx, "orders", key);
      const fresh = await this.access.get(a, "orders", key, tx);
      if (!orderInProgress(fresh.status)) fail("仅未登记收款的进行中订单可关闭");
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
      const commissions = await tx.commission.findMany({
        where: { orderId: key, deletedAt: null, status: { not: "VOID" } },
      });
      if (
        await tx.expense.count({
          where: { orderId: key, deletedAt: null, status: { not: "VOID" } },
        })
      )
        fail("存在未处理的付款单，不能关闭订单");
      for (const c of commissions)
        await update(
          tx,
          "commissions",
          c,
          { status: "VOID" },
          a,
          "关闭订单，作废佣金",
        );
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
