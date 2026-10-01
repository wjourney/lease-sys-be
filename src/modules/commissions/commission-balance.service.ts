import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { fail } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class CommissionBalanceService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
  ) {}
  async commissionBalance(tx: any, key: string, additional: any) {
    const c = await tx.commission.findUnique({ where: { id: key } });
    if (!c || c.deletedAt || c.status === "VOID" || c.amount === null)
      fail("佣金尚未填写或已作废");
    const es = await tx.expense.findMany({
      where: {
        commissionId: key,
        status: { in: ["UNPAID", "PAID"] },
        deletedAt: null,
      },
    });
    const committed = es.reduce((n, x) => n.add(x.amount), number(0));
    if (committed.add(additional).gt(c.amount!)) fail("金额超过佣金可支付余额");
    return c;
  }
}
