import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { lock, update } from "../../common/database/record-mutations";
import { ownerMap } from "../../common/resources/resource-map";
import { ResourceService } from "../../common/resources/resource.service";
import { demand, fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { StorageService } from "../../common/storage/storage.service";
import { MaterialsSchema } from "./dto/materials.schema";
import { normalizeUploadName } from "./file-name";
@Injectable()
export class MaterialsService extends ResourceService {
  readonly resource = "materials";
  protected schema = MaterialsSchema;
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
    @Inject(StorageService)
    private readonly storage: StorageService,
  ) {
    super(db, access);
  }
  async enrich(a: Actor, row: any) {
    const result = await super.enrich(a, row);
    if (result.originalName)
      result.originalName = normalizeUploadName(result.originalName);
    result.previewUrl = row.storageKey
      ? await this.storage.previewUrl(
          { storageProvider: row.storageProvider, storageKey: row.storageKey },
          `/api/v1/materials/${row.id}/download`,
        )
      : null;
    return result;
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    if (
      ["VIDEO", "PROJECT_FILE"].includes(data.category) &&
      !data.projectId &&
      !data.unitId
    )
      fail("视频和文件必须关联项目或单位");
    const keys = Object.keys(ownerMap).filter((k) => data[k]);
    if (keys.length !== 1) fail("文件资料必须且只能选择一个业务归属");
    await this.access.get(a, ownerMap[keys[0]], data[keys[0]], tx);
    if (!internal(a)) {
      demand(a.role !== "SALES");
      const k = keys[0];
      if (a.role === "SALES_COMPANY_ADMIN") {
        demand(
          k === "salesCompanyId" &&
            !!a.salesCompanyId &&
            data.salesCompanyId === a.salesCompanyId &&
            ["LOGO", "PHOTO"].includes(data.category),
        );
      } else if (k === "incomeId") {
        const receipt = await this.access.get(a, "incomes", data.incomeId, tx);
        if (receipt.recordType !== "RECEIPT" || receipt.status !== "PENDING")
          fail("只能为待确认收款上传凭证");
        data.category = "VOUCHER";
      } else if (k === "userId") {
        demand(data.userId === a.id);
        data.category = "PHOTO";
      } else if (k === "orderId") {
        demand(data.category !== "CONTRACT", "正式合同由后台生成");
      } else demand(false);
      data.visibility = "SHARED";
    }
  }
  async remove(a: Actor, key: string, reason: string) {
    if (a.role !== "SALES_COMPANY_ADMIN") return super.remove(a, key, reason);
    demand(!!a.salesCompanyId && !!reason?.trim());
    return this.db.$transaction(async (tx) => {
      await lock(tx, "materials", key);
      const row = await this.access.get(a, "materials", key, tx);
      demand(
        row.salesCompanyId === a.salesCompanyId &&
          ["LOGO", "PHOTO"].includes(row.category),
      );
      return update(
        tx,
        "materials",
        row,
        { deletedAt: new Date(), deletedBy: a.id },
        a,
        reason,
      );
    });
  }
}
