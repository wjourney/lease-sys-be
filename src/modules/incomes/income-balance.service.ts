import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { number } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class IncomeBalanceService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
  ) {}
  async totals(tx: any, key: string) {
    const parent = await tx.income.findUnique({ where: { id: key } });
    const children = await tx.income.findMany({
      where: { parentId: key, deletedAt: null },
    });
    const sum = (status: string) =>
      children
        .filter((x) => x.status === status)
        .reduce((n, x) => n.add(x.amount), number(0));
    const confirmed = sum("CONFIRMED"),
      pending = sum("PENDING"),
      total = number(parent.amount).add(parent.adjustmentAmount);
    return {
      total,
      confirmed,
      pending,
      offset: number(parent.depositOffsetAmount),
      remaining: total.sub(confirmed).sub(parent.depositOffsetAmount ?? 0),
      available: total
        .sub(confirmed)
        .sub(pending)
        .sub(parent.depositOffsetAmount ?? 0),
    };
  }
}
