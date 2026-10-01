import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { ResourceService } from "../../common/resources/resource.service";
import { PrismaService } from "../../database/prisma.service";
import { SalesCompaniesSchema } from "./dto/sales-companies.schema";
@Injectable()
export class SalesCompaniesService extends ResourceService {
  readonly resource = "sales-companies";
  protected schema = SalesCompaniesSchema;
  protected prefix: [string, string] = ["companyNo", "C"];
  protected references: [string, string][] = [
    ["user", "salesCompanyId"],
    ["order", "salesCompanyId"],
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
