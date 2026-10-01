import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { insert } from "../../common/database/record-mutations";
import { dayAfter, rentPeriod } from "../../common/utils/rent-period";
import { serial } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class RentBillingService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
  ) {}
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
