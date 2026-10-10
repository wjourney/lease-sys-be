import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { isDeepStrictEqual } from "node:util";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { StorageService } from "../../common/storage/storage.service";
import { PdfService } from "../../common/storage/pdf.service";
import { demand, fail } from "../../common/utils/errors";
import { number, plain } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { CONTRACT_DOCUMENT_VERSION, contractHtml } from "./contract-document";

export function orderContractSnapshot(o: any) {
  return plain({
    tenantType: o.tenantType,
    tenantName: o.tenantName,
    tenantRegistrationNo: o.tenantRegistrationNo || "",
    tenantContactName: o.tenantContactName || "",
    tenantPhone: o.tenantPhone || "",
    tenantEmail: o.tenantEmail || "",
    startsOn: o.startsOn,
    endsOn: o.endsOn,
    monthlyRent: number(o.monthlyRent).toString(),
    depositAmount: number(o.depositAmount).toString(),
    depositPlan: o.depositPlan || null,
    firstPeriodProration: Boolean(o.firstPeriodProration),
    lastPeriodProration: Boolean(o.lastPeriodProration),
    currency: o.currency || "HKD",
    paymentIntervalMonths: o.paymentIntervalMonths || 1,
    rentDueDay: o.rentDueDay,
    remark: o.remark || "",
  });
}

export type PreparedContract = {
  file: Awaited<ReturnType<StorageService["save"]>>;
  templateId?: string;
  snapshot: any;
};

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
              status: "ACTIVE",
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
          status: "ACTIVE",
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
            status: "ACTIVE",
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
  // Render before acquiring database locks. The order, bills and contract switch
  // are then committed together by the caller's transaction.
  async withChange<T>(
    before: any,
    next: any,
    save: (prepared: PreparedContract | null) => Promise<T>,
  ): Promise<T> {
    if (
      isDeepStrictEqual(
        orderContractSnapshot(before),
        orderContractSnapshot(next),
      )
    )
      return save(null);
    let prepared: PreparedContract;
    try {
      const current = before.currentContractMaterialId
        ? await this.db.material.findUnique({
            where: { id: before.currentContractMaterialId },
          })
        : null;
      prepared = await this.prepare(
        next,
        current?.templateMaterialId ?? undefined,
      );
    } catch {
      return fail("合同生成失败，订单未保存，请稍后重试");
    }
    try {
      return await save(prepared);
    } catch (error) {
      await this.storage.discard(prepared.file);
      throw error;
    }
  }
  async activate(
    tx: any,
    a: Actor,
    o: any,
    prepared: PreparedContract | null,
    reason: string,
  ) {
    if (!prepared) return o;
    if (
      !isDeepStrictEqual(
        prepared.snapshot.orderDetails,
        orderContractSnapshot(o),
      )
    )
      throw new ConflictException("订单资料已变化，请刷新后重新保存");
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
          {
            isCurrent: false,
            status: "VOID",
            voidedAt: new Date(),
            voidReason: reason,
          },
          a,
          reason,
        );
      }
    }
    const m = await insert(
      tx,
      "materials",
      {
        orderId: o.id,
        category: "CONTRACT",
        title: o.orderNo + " 租赁合同",
        ...prepared.file,
        mimeType: "application/pdf",
        originalName: `${o.orderNo} 租赁合同 V${version}.pdf`,
        templateMaterialId: prepared.templateId,
        contractSnapshot: prepared.snapshot,
        ...(group ? { materialGroupId: group } : {}),
        versionNo: version,
        isCurrent: true,
        status: "ACTIVE",
      },
      a,
    );
    return update(
      tx,
      "orders",
      o,
      { currentContractMaterialId: m.id },
      a,
      `生成合同 V${version}：${reason}`,
    );
  }
  private async generate(a: Actor, key: string, templateId?: string) {
    const o = await this.access.get(a, "orders", key);
    if (o.status === "DRAFT") fail("请先完善租约资料，再生成合同");
    const prepared = await this.prepare(o, templateId);
    try {
      const saved = await this.db.$transaction(async (tx) => {
        await lock(tx, "orders", key);
        const fresh = await this.access.get(a, "orders", key, tx);
        if (fresh.revision !== o.revision)
          throw new ConflictException("生成期间订单已修改，请重新生成");
        return this.activate(tx, a, fresh, prepared, "重新生成合同");
      });
      return this.db.material.findUniqueOrThrow({
        where: { id: saved.currentContractMaterialId },
      });
    } catch (error) {
      await this.storage.discard(prepared.file);
      throw error;
    }
  }
  private async prepare(
    o: any,
    templateId?: string,
  ): Promise<PreparedContract> {
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
    return {
      file,
      templateId: template?.id,
      snapshot: plain({
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
    };
  }
}
