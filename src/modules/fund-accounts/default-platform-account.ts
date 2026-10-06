import { fail } from "../../common/utils/errors";

/** Fill a missing account on new payment data, without rewriting historical references. */
export async function defaultInitialAccount(
  tx: any,
  payment: any,
  currency = "HKD",
) {
  if (!payment || payment.fundAccountId) return;
  const accounts = await tx.fundAccount.findMany({
    where: { deletedAt: null },
    take: 2,
  });
  const account = accounts.length === 1 ? accounts[0] : undefined;
  if (
    !account?.enabled ||
    account.currency !== currency ||
    !account.bankName?.trim() ||
    !account.accountIdentifier?.trim()
  ) {
    if (payment.paid) fail("请先在系统设置中配置唯一且有效的平台账户");
    return;
  }
  payment.fundAccountId = account.id;
}
