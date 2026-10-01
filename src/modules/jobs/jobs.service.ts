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
    const expired = await this.db.order.findMany({
      where: {
        status: "ACTIVE",
        deletedAt: null,
        endsOn: {
          lt: new Date(now.getTime() - 86400000),
        },
      },
    });
    for (const o of expired)
      await this.db.$transaction(async (tx) => {
        await lock(tx, "orders", o.id);
        const current = await tx.order.findUnique({
          where: {
            id: o.id,
          },
        });
        if (current?.status === "ACTIVE")
          await update(
            tx,
            "orders",
            current,
            {
              status: "COMPLETED",
              nextBillOn: null,
            },
            a,
            "租期结束，待登记交还",
          );
      });
    const cutoff = new Date(now.toISOString().slice(0, 10) + "T00:00:00Z");
    const orders = await this.db.order.findMany({
      where: {
        status: {
          in: ["PENDING", "ACTIVE"],
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
            o?.nextBillOn &&
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
        while (root && next && next <= cutoff) {
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
