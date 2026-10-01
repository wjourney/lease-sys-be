import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { number, serial } from "../../common/utils/value";
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
      .object({ deductionAmount: money, reason: z.string().min(1) })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "orders", key);
      const o = await this.access.get(a, "orders", key, tx);
      if (o.status !== "COMPLETED" || o.handoverStatus !== "DONE")
        fail("交还完成后才能结算押金");
      if (o.depositSettledAt) fail("押金已结算");
      const root = await tx.income.findFirst({
        where: { orderId: key, recordType: "RECEIVABLE", feeType: "DEPOSIT" },
      });
      const receipts = root
        ? await tx.income.findMany({
            where: { parentId: root.id, status: "CONFIRMED", deletedAt: null },
          })
        : [];
      const received = receipts.reduce((n, x) => n.add(x.amount), number(0));
      if (number(d.deductionAmount).gt(received)) fail("扣除金额超过实收押金");
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
          depositSettledAt: new Date(),
        },
        a,
        d.reason,
      );
    });
  }
}
