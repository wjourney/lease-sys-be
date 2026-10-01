import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { LocalStorageService } from "../../common/storage/local-storage.service";
import { PdfService } from "../../common/storage/pdf.service";
import { demand, fail } from "../../common/utils/errors";
import { plain } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class ContractsService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(LocalStorageService) readonly storage: LocalStorageService,
    @Inject(PdfService) readonly pdfRenderer: PdfService,
  ) {}
  async contract(a: Actor, key: string, templateId?: string) {
    demand(["SUPER_ADMIN", "OPERATIONS"].includes(a.role));
    const o = await this.access.get(a, "orders", key);
    let template: any = null;
    if (templateId) {
      template = await this.access.get(a, "materials", templateId);
      if (template.category !== "TEMPLATE") fail("请选择合同模板");
    }
    const file = await this.storage.save(
      await this.pdfRenderer.pdf(
        this.pdfRenderer.html(
          "租赁合同资料",
          [
            ["订单号", o.orderNo],
            ["租客", o.tenantName],
            ["联系号码", o.tenantPhone],
            [
              "租期",
              o.startsOn.toISOString().slice(0, 10) +
                " 至 " +
                o.endsOn.toISOString().slice(0, 10),
            ],
            ["月租", o.currency + " " + o.monthlyRent],
            ["押金", o.currency + " " + o.depositAmount],
          ],
          template?.body ||
            "合同条款请在项目开单资料中维护，生成时选择相应模板。",
        ),
      ),
    );
    return this.db.$transaction(async (tx) => {
      await lock(tx, "orders", key);
      const fresh = await tx.order.findUnique({ where: { id: key } });
      if (fresh?.revision !== o.revision)
        throw new ConflictException("生成期间订单已修改，请重新生成");
      let group: string | undefined;
      let version = 1;
      if (o.currentContractMaterialId) {
        const old = await tx.material.findUnique({
          where: { id: o.currentContractMaterialId },
        });
        if (old) {
          group = old.materialGroupId;
          version = old.versionNo + 1;
          await update(
            tx,
            "materials",
            old,
            { isCurrent: false },
            a,
            "生成合同新版本",
          );
        }
      }
      const m = await insert(
        tx,
        "materials",
        {
          orderId: key,
          category: "CONTRACT",
          title: o.orderNo + " 租赁合同",
          ...file,
          mimeType: "application/pdf",
          originalName: o.orderNo + ".pdf",
          templateMaterialId: template?.id,
          contractSnapshot: plain({
            orderNo: o.orderNo,
            tenantName: o.tenantName,
            startsOn: o.startsOn,
            endsOn: o.endsOn,
            monthlyRent: o.monthlyRent,
            depositAmount: o.depositAmount,
            templateBody: template?.body,
          }),
          ...(group ? { materialGroupId: group } : {}),
          versionNo: version,
        },
        a,
      );
      await update(
        tx,
        "orders",
        fresh,
        { currentContractMaterialId: m.id },
        a,
        "生成合同",
      );
      return m;
    });
  }
}
