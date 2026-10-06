import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class AccountValidationService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
  ) {}
  async checkAccount(tx: any, key: string, currency: string) {
    const f = await tx.fundAccount.findFirst({
      where: { id: key, enabled: true, deletedAt: null },
    });
    if (
      !f ||
      f.currency !== currency ||
      !f.bankName?.trim() ||
      !f.accountIdentifier?.trim()
    )
      fail("请选择同币种且资料完整的有效资金账户");
  }
}
