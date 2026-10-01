import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { ResourceService } from "../../common/resources/resource.service";
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
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
  ) {
    super(db, access);
  }
}
