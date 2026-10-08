import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { lock, update } from "../../common/database/record-mutations";
import { demand, fail } from "../../common/utils/errors";
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
      "payoutBankName",
      "payoutAccountName",
      "payoutAccountNo",
      "registrationExpiresOn",
    ];
    demand(
      Object.keys(data).every((key) => fields.includes(key)),
      "只能修改本公司基本资料",
    );
  }
  async orderImages(a: Actor, companyId: string, body: any) {
    this.access.allow(a, "sales-companies", true);
    const ids = z.array(z.string().uuid()).max(100).parse(body?.ids);
    if (new Set(ids).size !== ids.length) fail("公司图片列表包含重复文件");
    return this.db.$transaction(async (tx) => {
      await lock(tx, "sales-companies", companyId);
      await this.access.get(a, "sales-companies", companyId, tx);
      const images = await tx.material.findMany({
        where: {
          salesCompanyId: companyId,
          category: { in: ["PHOTO", "LOGO"] },
          storageKey: { not: null },
          deletedAt: null,
          isCurrent: true,
        },
      });
      if (
        images.length !== ids.length ||
        ids.some((id) => !images.some((image) => image.id === id))
      )
        fail("公司图片列表已变化，请刷新后重试");
      for (const [index, id] of ids.entries()) {
        const image = images.find((item) => item.id === id)!;
        if (image.sortOrder !== index)
          await update(
            tx,
            "materials",
            image,
            { sortOrder: index },
            a,
            "调整公司图片顺序与 Logo",
          );
      }
      return { ok: true };
    });
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
