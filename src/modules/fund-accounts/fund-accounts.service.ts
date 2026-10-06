import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { FundAccountsSchema } from "./dto/fund-accounts.schema";
@Injectable()
export class FundAccountsService extends ResourceService {
  readonly resource = "fund-accounts";
  protected schema = FundAccountsSchema;
  protected references: [string, string][] = [
    ["income", "fundAccountId"],
    ["expense", "fundAccountId"],
  ];
  protected async validate(_actor: Actor, data: any, _tx: any, row?: any) {
    const account = { ...row, ...data };
    if (
      account.enabled !== false &&
      (!account.bankName?.trim() || !account.accountIdentifier?.trim())
    )
      fail("启用资金账户前，请填写银行名称和银行账号");
  }
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
  ) {
    super(db, access);
  }
}
