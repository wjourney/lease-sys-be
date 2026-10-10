import { actorSnapshot } from "../../common/database/operation-actors";
import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
import { number, plain } from "../../common/utils/value";
import { date, money } from "../../common/validation/fields";
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
        amount: money.optional(),
        sourceKey: z.string().uuid().optional(),
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
      const records =
        Array.isArray(e.paymentRecords) && e.paymentRecords.length
          ? (e.paymentRecords as any[])
          : number(e.paidAmount).gt(0)
            ? [
                {
                  amount: number(e.paidAmount).toFixed(2),
                  paidOn: e.paidOn,
                  fundAccountId: e.fundAccountId,
                  paymentMethod: e.paymentMethod,
                  bankReference: e.bankReference,
                },
              ]
            : [];
      const duplicate =
        d.sourceKey && records.find((x) => x.sourceKey === d.sourceKey);
      if (duplicate) {
        if (
          (d.amount !== undefined && !number(duplicate.amount).eq(d.amount)) ||
          duplicate.fundAccountId !== d.fundAccountId ||
          duplicate.paymentMethod !== d.paymentMethod ||
          new Date(duplicate.paidOn).getTime() !== d.paidOn.getTime() ||
          (duplicate.bankReference || "") !== (d.bankReference || "")
        )
          fail("重复提交编号冲突");
        return e;
      }
      if (e.status === "PAID") {
        if (d.amount !== undefined) fail("该支出已付清");
        return e;
      }
      if (e.status !== "UNPAID") fail("该支出不可付款");
      await this.accounts.checkAccount(tx, d.fundAccountId, e.currency);
      if (e.commissionId)
        await this.commissions.commissionBalance(tx, e.commissionId, number(0));
      const { amount, sourceKey, ...payment } = d;
      const remaining = number(e.amount).sub(e.paidAmount);
      const paying = amount === undefined ? remaining : number(amount);
      if (paying.lte(0) || paying.gt(remaining)) fail("付款金额超过待付余额");
      if (!paying.eq(remaining)) fail("不支持部分付款，请一次付清支出剩余金额");
      if (amount !== undefined && !sourceKey)
        fail("登记付款需要有效的提交编号");
      const paidAmount = number(e.paidAmount).add(paying);
      return update(
        tx,
        "expenses",
        e,
        {
          ...payment,
          paidAmount,
          status: "PAID",
          paymentRecords: plain([
            ...records,
            {
              ...payment,
              sourceKey,
              amount: paying.toFixed(2),
              operator: a.name,
              ...actorSnapshot(a),
            },
          ]),
        },
        a,
        "登记付款",
      );
    });
  }
}
