import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { demand } from "../../common/utils/errors";
import { ResourceService } from "../../common/resources/resource.service";
import { PrismaService } from "../../database/prisma.service";
import { SalesCompaniesSchema } from "./dto/sales-companies.schema";
@Injectable()
export class SalesCompaniesService extends ResourceService {
  readonly resource = "sales-companies";
  protected schema = SalesCompaniesSchema;
  async create(a: Actor, body: any) {
    demand(a.role !== "SALES_COMPANY_ADMIN");
    return super.create(a, body);
  }
  async remove(a: Actor, key: string, reason: string) {
    demand(a.role !== "SALES_COMPANY_ADMIN");
    return super.remove(a, key, reason);
  }
  protected async beforeEdit(a: Actor, data: any, _tx: any, row: any) {
    if (a.role !== "SALES_COMPANY_ADMIN") return;
    demand(!!a.salesCompanyId && row.id === a.salesCompanyId);
    const fields = [
      "name",
      "nameEn",
      "contactName",
      "phone",
      "email",
      "address",
      "serviceArea",
      "registrationNo",
      "registrationExpiresOn",
    ];
    demand(
      Object.keys(data).every((key) => fields.includes(key)),
      "只能修改本公司基本资料",
    );
  }
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
