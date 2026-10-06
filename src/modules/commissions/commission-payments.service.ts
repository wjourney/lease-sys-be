import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { insert, lock } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { number, serial } from "../../common/utils/value";
import { date, money } from "../../common/validation/fields";
import { PrismaService } from "../../database/prisma.service";
import { AccountValidationService } from "../fund-accounts/account-validation.service";
import { CommissionBalanceService } from "./commission-balance.service";
@Injectable()
export class CommissionPaymentsService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(AccountValidationService)
    readonly accounts: AccountValidationService,
    @Inject(CommissionBalanceService)
    readonly balances: CommissionBalanceService,
  ) {}
  async commissionPay(a: Actor, key: string, body: any) {
    demand(financial(a));
    const d = z
      .object({
        amount: money,
        paidOn: date,
        fundAccountId: z.string().uuid(),
        paymentMethod: z.string().min(1),
        bankReference: z.string().optional(),
        sourceKey: z.string().uuid(),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await this.access.get(a, "commissions", key, tx);
      await lock(tx, "commissions", key);
      const existing = await tx.expense.findUnique({
        where: { sourceKey: d.sourceKey },
      });
      if (existing) {
        if (
          existing.commissionId !== key ||
          !number(existing.amount).eq(d.amount) ||
          existing.fundAccountId !== d.fundAccountId ||
          existing.paymentMethod !== d.paymentMethod ||
          existing.paidOn?.getTime() !== d.paidOn.getTime() ||
          (existing.bankReference || "") !== (d.bankReference || "")
        )
          fail("重复提交编号冲突");
        return existing;
      }
      if (number(d.amount).lte(0)) fail("付款金额必须大于零");
      const c = await this.balances.commissionBalance(
        tx,
        key,
        number(d.amount),
      );
      await this.accounts.checkAccount(tx, d.fundAccountId, c.currency);
      const company = await tx.salesCompany.findUnique({
        where: { id: c.salesCompanyId },
      });
      return insert(
        tx,
        "expenses",
        {
          expenseNo: serial("E"),
          orderId: c.orderId,
          commissionId: c.id,
          feeType: "COMMISSION",
          paidAmount: d.amount,
          currency: c.currency,
          payeeName: company?.name ?? "销售公司",
          status: "PAID",
          ...d,
        },
        a,
      );
    });
  }
}
