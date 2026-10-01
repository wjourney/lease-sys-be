import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor, internal } from "../../common/auth/actor";
import { ownerMap } from "../../common/resources/resource-map";
import { ResourceService } from "../../common/resources/resource.service";
import { demand, fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
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
  ) {
    super(db, access);
  }
  async enrich(a: Actor, row: any) {
    const result = await super.enrich(a, row);
    if (result.originalName)
      result.originalName = normalizeUploadName(result.originalName);
    return result;
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    if (["VIDEO", "PROJECT_FILE"].includes(data.category) && !data.projectId && !data.unitId)
      fail("视频和文件必须关联项目或单位");
    const keys = Object.keys(ownerMap).filter((k) => data[k]);
    if (keys.length !== 1) fail("文件资料必须且只能选择一个业务归属");
    await this.access.get(a, ownerMap[keys[0]], data[keys[0]], tx);
    if (!internal(a)) {
      const k = keys[0];
      if (k === "incomeId") {
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
  protected async beforeCreate(
    _a: Actor,
    data: any,
    tx: any,
    options?: { replacingMaterialGroupId?: string },
  ) {
    if (data.category !== "LOGO" || !data.projectId) return;
    await tx.$queryRaw`SELECT id FROM projects WHERE id = ${data.projectId} FOR UPDATE`;
    const count = await tx.material.count({
      where: {
        projectId: data.projectId,
        category: "LOGO",
        deletedAt: null,
        isCurrent: true,
        ...(options?.replacingMaterialGroupId
          ? { materialGroupId: { not: options.replacingMaterialGroupId } }
          : {}),
      },
    });
    if (count >= 4) fail("每个项目最多上传 4 张 Logo");
  }
}
