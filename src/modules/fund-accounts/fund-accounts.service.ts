import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { insert } from "../../common/database/record-mutations";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { FundAccountsSchema } from "./dto/fund-accounts.schema";
@Injectable()
export class FundAccountsService extends ResourceService {
  readonly resource = "fund-accounts";
  protected schema = FundAccountsSchema;
  async create(a: Actor, body: any) {
    this.access.allow(a, this.resource, true);
    const data = this.schema.strict().parse(body);
    try {
      // Serializable range reads also protect the first insert into an empty table.
      return await this.db.$transaction(
        async (tx) => {
          if (await tx.fundAccount.findFirst({ where: { deletedAt: null } }))
            fail("只允许创建一个平台账户，请编辑已有账户");
          await this.validate(a, data, tx);
          return insert(tx, this.resource, data, a);
        },
        { isolationLevel: "Serializable" },
      );
    } catch (e: any) {
      if (e.code === "P2034") fail("平台账户创建冲突，请刷新后查看已有账户");
      throw e;
    }
  }
  async remove(a: Actor, _key: string, _reason: string): Promise<never> {
    this.access.allow(a, this.resource, true);
    return fail("平台账户只允许编辑，不能删除");
  }
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
