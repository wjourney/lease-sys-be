import { leaseToday } from "../../common/utils/lease-date";
import {
  orderInProgress,
  inProgressOrderStatuses,
} from "../../common/utils/order-status";
import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { demand } from "../../common/utils/errors";
import { plusMonths } from "../../common/utils/rent-period";
import { serial } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { RentBillingService } from "../incomes/rent-billing.service";
@Injectable()
export class JobsService {
  constructor(
    @Inject(PrismaService)
    readonly db: PrismaService,
    @Inject(AccessService)
    readonly access: AccessService,
    @Inject(RentBillingService)
    readonly billing: RentBillingService,
  ) {}
  async generateDue(a: Actor, now = new Date()) {
    demand(financial(a));
    const cutoff = leaseToday(now);
    const expired = await this.db.order.findMany({
      where: {
        status: { in: inProgressOrderStatuses },
        deletedAt: null,
        endsOn: {
          lt: cutoff,
        },
      },
    });
    for (const o of expired)
      await this.db.$transaction(async (tx) => {
        if (o.unitId) await lock(tx, "units", o.unitId);
        await lock(tx, "orders", o.id);
        let current = await tx.order.findUnique({
          where: {
            id: o.id,
          },
        });
        // Renewal can race the expiry scan. Check the locked current end date.
        if (
          !current ||
          !orderInProgress(current.status) ||
          current.deletedAt ||
          current.endsOn >= cutoff
        )
          return;
        // Catch up every due period before stopping the schedule at expiry.
        while (
          current &&
          orderInProgress(current.status) &&
          !current.deletedAt &&
          current.nextBillOn &&
          current.nextBillOn <= current.endsOn
        ) {
          const b = await this.billing.bill(tx, current, current.nextBillOn, a);
          current = await update(
            tx,
            "orders",
            current,
            { nextBillOn: b.next <= current.endsOn ? b.next : null },
            a,
            "租期结束补齐账单",
          );
        }
        if (current && orderInProgress(current.status) && !current.deletedAt)
          await update(
            tx,
            "orders",
            current,
            {
              status: "COMPLETED",
              nextBillOn: null,
              occupancyState: "RELEASED",
              handoverStatus: "DONE",
              handedOverAt: current.endsOn,
            },
            a,
            "租期到期自动结束，释放单位",
          );
      });
    // Release legacy ended orders too, so removing the handover UI cannot strand units.
    const legacyEnded = await this.db.order.findMany({
      where: {
        status: "COMPLETED",
        deletedAt: null,
        occupancyState: { not: "RELEASED" },
      },
    });
    for (const o of legacyEnded)
      await this.db.$transaction(async (tx) => {
        if (o.unitId) await lock(tx, "units", o.unitId);
        await lock(tx, "orders", o.id);
        const current = await tx.order.findUnique({ where: { id: o.id } });
        if (
          current &&
          current.status === "COMPLETED" &&
          !current.deletedAt &&
          current.occupancyState !== "RELEASED"
        )
          await update(
            tx,
            "orders",
            current,
            {
              occupancyState: "RELEASED",
              handoverStatus: "DONE",
              handedOverAt: current.actualTerminationOn ?? current.endsOn,
              nextBillOn: null,
            },
            a,
            "已结束租约释放单位",
          );
      });
    const orders = await this.db.order.findMany({
      where: {
        status: {
          in: inProgressOrderStatuses,
        },
        deletedAt: null,
        nextBillOn: {
          not: null,
        },
      },
    });
    let count = 0;
    for (const current of orders)
      await this.db.$transaction(
        async (tx) => {
          await lock(tx, "orders", current.id);
          let o = await tx.order.findUnique({
            where: {
              id: current.id,
            },
          });
          while (
            o &&
            orderInProgress(o.status) &&
            !o.deletedAt &&
            o.nextBillOn &&
            o.nextBillOn <= o.endsOn &&
            o.nextBillOn.getTime() - o.billLeadDays * 86400000 <=
              cutoff.getTime()
          ) {
            const b = await this.billing.bill(tx, o, o.nextBillOn, a);
            o = await update(
              tx,
              "orders",
              o,
              {
                nextBillOn: b.next <= o.endsOn ? b.next : null,
              },
              a,
              "周期出账",
            );
            count++;
          }
        },
        {
          timeout: 20000,
        },
      );
    const recurring = await this.db.income.findMany({
      where: {
        recordType: "RECEIVABLE",
        deletedAt: null,
        status: {
          not: "VOID",
        },
        nextGenerationOn: {
          lte: cutoff,
        },
      },
    });
    for (const current of recurring)
      await this.db.$transaction(async (tx) => {
        await lock(tx, "incomes", current.id);
        let root = await tx.income.findUnique({
          where: {
            id: current.id,
          },
        });
        let next =
          (root?.recurrenceRule as any)?.frequency === "MONTHLY"
            ? root?.nextGenerationOn
            : null;
        while (root && !root.deletedAt && next && next <= cutoff) {
          const sourceKey = `recurring:${root.id}:${next.toISOString().slice(0, 10)}`;
          if (
            !(await tx.income.findUnique({
              where: {
                sourceKey,
              },
            }))
          ) {
            await insert(
              tx,
              "incomes",
              {
                recordNo: serial("B"),
                recordType: "RECEIVABLE",
                feeType: root.feeType,
                amount: root.amount,
                currency: root.currency,
                orderId: root.orderId,
                projectId: root.projectId,
                unitId: root.unitId,
                dueOn: next,
                payerName: root.payerName,
                payerEmail: root.payerEmail,
                sourceKey,
                status: "OPEN",
              },
              a,
            );
            count++;
          }
          next = plusMonths(next, 1);
        }
        if (root)
          await update(
            tx,
            "incomes",
            root,
            {
              nextGenerationOn: next,
            },
            a,
            "手工周期出账",
          );
      });
    return {
      generated: count,
    };
  }
}
