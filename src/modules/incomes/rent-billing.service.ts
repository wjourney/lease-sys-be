import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { insert } from "../../common/database/record-mutations";
import { dayAfter, rentPeriod } from "../../common/utils/rent-period";
import { fail } from "../../common/utils/errors";
import { serial } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class RentBillingService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
  ) {}
  async fullTerm(tx: any, order: any, actor: Actor, preserveHistory = false) {
    const existing = preserveHistory ? await tx.income.findMany({ where: { orderId: order.id, recordType: "RECEIVABLE", feeType: "RENT" } }) : [];
    let cursor = order.startsOn;
    for (let index = 0; cursor <= order.endsOn; index++) {
      if (index >= 600) fail("租期最多支持 600 个月");
      const period = rentPeriod(order, cursor);
      const overlaps = existing.some((r: any) => r.periodStart && r.periodEnd && r.periodStart <= period.end && r.periodEnd >= cursor);
      const next = overlaps ? dayAfter(period.end) : (await this.bill(tx, order, cursor, actor)).next;
      if (next <= cursor) fail("账期生成失败");
      cursor = next;
    }
  }
  async bill(tx: any, o: any, start: Date, a: Actor) {
    const p = rentPeriod(o, start);
    const sourceKey = `rent:${o.id}:${start.toISOString().slice(0, 10)}`;
    let row = await tx.income.findUnique({ where: { sourceKey } });
    if (!row) {
      const due = new Date(start);
      due.setUTCDate(
        Math.min(
          o.rentDueDay,
          new Date(
            Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0),
          ).getUTCDate(),
        ),
      );
      row = await insert(
        tx,
        "incomes",
        {
          recordNo: serial("B"),
          recordType: "RECEIVABLE",
          orderId: o.id,
          projectId: o.projectId,
          unitId: o.unitId,
          feeType: "RENT",
          amount: p.amount,
          currency: o.currency,
          periodStart: start,
          periodEnd: p.end,
          dueOn: due,
          payerName: o.tenantName,
          payerEmail: o.tenantEmail,
          status: "OPEN",
          sourceKey,
        },
        a,
      );
    }
    return { row, next: dayAfter(p.end) };
  }
}
