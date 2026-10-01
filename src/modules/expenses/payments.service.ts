import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { date } from "../../common/validation/fields";
import { PrismaService } from "../../database/prisma.service";
import { CommissionBalanceService } from "../commissions/commission-balance.service";
import { AccountValidationService } from "../fund-accounts/account-validation.service";
@Injectable()
export class PaymentsService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(AccountValidationService)
    readonly accounts: AccountValidationService,
    @Inject(CommissionBalanceService)
    readonly commissions: CommissionBalanceService,
  ) {}
  async pay(a: Actor, key: string, body: any) {
    demand(financial(a));
    const d = z
      .object({
        paidOn: date,
        fundAccountId: z.string().uuid(),
        paymentMethod: z.string().min(1),
        bankReference: z.string().optional(),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      const first = await this.access.get(a, "expenses", key, tx);
      if (first.commissionId) await lock(tx, "commissions", first.commissionId);
      if (first.feeType === "DEPOSIT_REFUND" && first.orderId)
        await lock(tx, "orders", first.orderId);
      await lock(tx, "expenses", key);
      const e = await this.access.get(a, "expenses", key, tx);
      if (e.status === "PAID") return e;
      if (e.status !== "UNPAID") fail("该支出不可付款");
      await this.accounts.checkAccount(tx, d.fundAccountId, e.currency);
      if (e.commissionId)
        await this.commissions.commissionBalance(tx, e.commissionId, number(0));
      return update(
        tx,
        "expenses",
        e,
        { ...d, paidAmount: e.amount, status: "PAID" },
        a,
        "登记付款",
      );
    });
  }
}
