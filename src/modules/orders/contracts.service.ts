import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { StorageService } from "../../common/storage/storage.service";
import { PdfService } from "../../common/storage/pdf.service";
import { demand, fail } from "../../common/utils/errors";
import { plain } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { CONTRACT_DOCUMENT_VERSION, contractHtml } from "./contract-document";

function orderContractSnapshot(o: any) {
  return plain({
    tenantType: o.tenantType,
    tenantName: o.tenantName,
    tenantRegistrationNo: o.tenantRegistrationNo,
    tenantContactName: o.tenantContactName,
    tenantPhone: o.tenantPhone,
    tenantEmail: o.tenantEmail,
    startsOn: o.startsOn,
    endsOn: o.endsOn,
    monthlyRent: o.monthlyRent,
    depositAmount: o.depositAmount,
    paymentIntervalMonths: o.paymentIntervalMonths,
    rentDueDay: o.rentDueDay,
    remark: o.remark,
  });
}

@Injectable()
export class ContractsService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(StorageService) readonly storage: StorageService,
    @Inject(PdfService) readonly pdfRenderer: PdfService,
  ) {}
  async contract(a: Actor, key: string, templateId?: string) {
    demand(["SUPER_ADMIN", "OPERATIONS"].includes(a.role));
    return this.generate(a, key, templateId);
  }
  async ensure(a: Actor, key: string) {
    const o = await this.access.get(a, "orders", key);
    if (o.status === "DRAFT") fail("请先完善租约资料，再生成合同");
    if (["SALES_COMPANY_ADMIN", "SALES"].includes(a.role)) {
      const current = o.currentContractMaterialId
        ? await this.db.material.findFirst({
            where: {
              id: o.currentContractMaterialId,
              orderId: key,
              deletedAt: null,
              isCurrent: true,
              category: "CONTRACT",
            },
          })
        : null;
      if (!current?.storageKey) return fail("合同尚未生成，请联系平台管理员");
      return current;
    }
    if (o.currentContractMaterialId) {
      const current = await this.db.material.findFirst({
        where: {
          id: o.currentContractMaterialId,
          orderId: key,
          category: "CONTRACT",
          deletedAt: null,
          isCurrent: true,
        },
      });
      if (
        current?.storageKey &&
        (current.contractSnapshot as any)?.documentVersion ===
          CONTRACT_DOCUMENT_VERSION &&
        isDeepStrictEqual(
          (current.contractSnapshot as any)?.orderDetails,
          orderContractSnapshot(o),
        )
      )
        return current;
      if (current)
        return this.generate(a, key, current.templateMaterialId ?? undefined);
    }
    return this.generate(a, key);
  }
  async download(a: Actor, key: string) {
    const o = await this.access.get(a, "orders", key);
    if (o.status === "DRAFT") fail("请先完善租约资料，再生成合同");
    const m = o.currentContractMaterialId
      ? await this.db.material.findFirst({
          where: {
            id: o.currentContractMaterialId,
            orderId: key,
            category: "CONTRACT",
            deletedAt: null,
            isCurrent: true,
          },
        })
      : null;
    if (!m?.storageKey) return fail("合同尚未生成，请重试");
    return {
      storageProvider: m.storageProvider,
      storageKey: m.storageKey,
      name: `${o.orderNo} 租赁合同.pdf`,
      type: "application/pdf",
    };
  }
  private async generate(a: Actor, key: string, templateId?: string) {
    const o = await this.access.get(a, "orders", key);
    if (o.status === "DRAFT") fail("请先完善租约资料，再生成合同");
    let template: any = null;
    if (templateId) {
      template = await this.db.material.findFirst({
        where: {
          id: templateId,
          projectId: o.projectId,
          category: "TEMPLATE",
          deletedAt: null,
        },
      });
      if (!template) fail("请选择当前项目的合同模板");
    } else {
      template = await this.db.material.findFirst({
        where: {
          projectId: o.projectId,
          category: "TEMPLATE",
          body: { not: null },
          deletedAt: null,
          isCurrent: true,
          status: "ACTIVE",
        },
        orderBy: { createdAt: "desc" },
      });
    }
    const [project, unit] = await Promise.all([
      this.db.project.findUnique({ where: { id: o.projectId } }),
      this.db.unit.findUnique({ where: { id: o.unitId } }),
    ]);
    const file = await this.storage.save(
      await this.pdfRenderer.pdf(
        contractHtml(o, project, unit, template?.body),
        { pageNumbers: true },
      ),
      "application/pdf",
    );
    try {
      return await this.db.$transaction(async (tx) => {
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
              documentVersion: CONTRACT_DOCUMENT_VERSION,
              orderNo: o.orderNo,
              tenantName: o.tenantName,
              startsOn: o.startsOn,
              endsOn: o.endsOn,
              monthlyRent: o.monthlyRent,
              depositAmount: o.depositAmount,
              projectName: project?.name,
              unitNo: unit?.unitNo,
              address: project?.address,
              orderDetails: orderContractSnapshot(o),
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
    } catch (error) {
      await this.storage.discard(file);
      throw error;
    }
  }
}
