import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { plusMonths } from "../../common/utils/rent-period";
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
  }
}
@Injectable()
export class OrderLifecycleService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(RentBillingService) readonly billing: RentBillingService,
  ) {}
  async createOrder(a: Actor, body: any) {
    this.access.allow(a, "orders", true);
    const d = OrdersSchema.strict().parse(body);
    if (d.startsOn > d.endsOn) fail("租期开始日期不能晚于结束日期");
    if (number(d.monthlyRent).lte(0)) fail("租金必须大于零");
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
            ...d,
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
    return this.db.$transaction(async (tx) => {
      let o = await this.access.get(a, "orders", key, tx);
      await lock(tx, "units", o.unitId);
      await lock(tx, "orders", key);
      o = await this.access.get(a, "orders", key, tx);
      if (o.revision !== revision)
        throw new ConflictException("订单已更新，请刷新");
      if (["CLOSED", "COMPLETED"].includes(o.status))
        fail("已完成或关闭订单不能修改租约");
      if (o.firstPaymentRegisteredAt && !internal(a))
        fail("已登记付款，请由授权运营修改");
      const next = { ...o, ...d };
      if (next.startsOn > next.endsOn) fail("租期无效");
      validateOrderDetails(next);
      await this.checkOccupancy(tx, o.unitId, next.startsOn, next.endsOn, o.id);
      const tenantChanged =
        d.tenantName !== undefined ||
        d.tenantPhone !== undefined ||
        d.tenantEmail !== undefined;
      return update(
        tx,
        "orders",
        o,
        {
          ...d,
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
      .object({ note: z.string().min(1) })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      const current = await this.access.get(a, "orders", key, tx);
      await lock(tx, "units", current.unitId);
      await lock(tx, "orders", key);
      const o = await this.access.get(a, "orders", key, tx);
      if (o.status !== "COMPLETED") fail("先完成退租再登记交还");
      return update(
        tx,
        "orders",
        o,
        {
          handoverStatus: "DONE",
          handedOverAt: new Date(),
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
