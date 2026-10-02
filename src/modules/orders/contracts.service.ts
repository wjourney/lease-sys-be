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
    moveInOn: o.moveInOn,
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
        isDeepStrictEqual(
          (current.contractSnapshot as any)?.orderDetails,
          orderContractSnapshot(o),
        )
      )
        return current;
      if (current) return this.generate(a, key, current.templateMaterialId ?? undefined);
    }
    return this.generate(a, key);
  }
  async download(a: Actor, key: string) {
    const o = await this.access.get(a, "orders", key);
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
    const dateText = (value: Date | null | undefined) =>
      value?.toISOString().slice(0, 10) || "待填写";
    const moneyText = (value: any) => `${o.currency} ${value}`;
    const property = [project?.name, unit?.unitNo].filter(Boolean).join(" · ");
    const defaultTerms = [
      "本合同依据录入的租赁资料自动生成，供出租方与承租方核对并签署。",
      "一、出租方同意将上列物业出租予承租方，租期、月租及押金以上表为准。",
      "二、承租方应按约定的交租日及付款周期支付租金；首末期不足月的计算方式以上表为准。",
      "三、物业交付、使用、维修、续租、退租及争议处理等未列事项，由双方在签署前另行确认。",
      "四、双方签署后各执一份；未签署的文件仅为合同草稿。",
      "出租方签署：________________    日期：________________",
      "承租方签署：________________    日期：________________",
    ].join("\n\n");
    const file = await this.storage.save(
      await this.pdfRenderer.pdf(
        this.pdfRenderer.html(
          "租赁合同（待签署）",
          [
            ["订单号", o.orderNo],
            ["项目及单位", property],
            ["物业地址", project?.address || "待填写"],
            ["承租方类型", o.tenantType === "COMPANY" ? "公司" : "个人"],
            ["承租方", o.tenantName],
            ["证件／登记号码", o.tenantRegistrationNo || "待填写"],
            ["联系人", o.tenantContactName || "待填写"],
            ["联系电话", o.tenantPhone || "待填写"],
            ["电子邮箱", o.tenantEmail || "待填写"],
            ["租期", `${dateText(o.startsOn)} 至 ${dateText(o.endsOn)}`],
            ["月租", moneyText(o.monthlyRent)],
            ["押金", moneyText(o.depositAmount)],
            ["交租安排", `每 ${o.paymentIntervalMonths} 个月支付，每月 ${o.rentDueDay} 日交租`],
            ["入住日期", dateText(o.moveInOn)],
            ["特别约定", o.remark || "无"],
          ],
          template?.body || defaultTerms,
          true,
        ),
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
