import { uploadFileType } from "./upload-file-type";
import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { update } from "../../common/database/record-mutations";
import {
  StoredFile,
  StorageService,
} from "../../common/storage/storage.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { MaterialsService } from "./materials.service";
import { normalizeUploadName } from "./file-name";
@Injectable()
export class MaterialFilesService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(StorageService) readonly storage: StorageService,
    @Inject(MaterialsService) readonly materials: MaterialsService,
  ) {}
  async upload(
    a: Actor,
    payload: any,
    file: Express.Multer.File,
    replacingMaterialGroupId?: string,
  ) {
    const detected = uploadFileType(file, payload.category);
    const b = file.buffer;
    const data = await this.materials.create(a, payload, {
      replacingMaterialGroupId,
    });
    let stored: StoredFile | undefined;
    try {
      stored = await this.storage.save(b, detected);
      return await this.db.$transaction((tx) =>
        update(
          tx,
          "materials",
          data,
          { ...stored, originalName: normalizeUploadName(file.originalname), mimeType: detected },
          a,
          "上传文件",
        ),
      );
    } catch (e) {
      if (stored) await this.storage.discard(stored);
      await this.db.material.update({
        where: { id: data.id },
        data: { deletedAt: new Date() },
      });
      throw e;
    }
  }
  async download(a: Actor, key: string) {
    const m = await this.access.get(a, "materials", key);
    if (!m.storageKey) fail("当前资料没有可下载文件");
    return {
      storageProvider: m.storageProvider,
      storageKey: m.storageKey,
      name: normalizeUploadName(m.originalName ?? m.title),
      type: m.mimeType ?? "application/octet-stream",
    };
  }

  async version(
    a: Actor,
    key: string,
    payload: any,
    file?: Express.Multer.File,
  ) {
    this.access.allow(a, "materials", true);
    const old = await this.access.get(a, "materials", key);
    const metadata = {
      ...Object.fromEntries(
        [
          "projectId",
          "unitId",
          "orderId",
          "incomeId",
          "expenseId",
          "invoiceId",
          "salesCompanyId",
          "userId",
        ]
          .filter((k) => old[k])
          .map((k) => [k, old[k]]),
      ),
      category: old.category,
      title: payload.title || old.title,
      description: payload.description ?? old.description ?? undefined,
      body: payload.body ?? old.body ?? undefined,
      visibility: old.visibility,
    };
    const created = file
      ? await this.upload(a, metadata, file, old.materialGroupId)
      : await this.materials.create(a, metadata, {
          replacingMaterialGroupId: old.materialGroupId,
        });
    try {
      return await this.db.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM materials WHERE materialGroupId = ${old.materialGroupId} ORDER BY id LIMIT 1 FOR UPDATE`;
        const current = await tx.material.findFirst({
          where: { materialGroupId: old.materialGroupId, isCurrent: true },
        });
        const max = await tx.material.aggregate({
          where: { materialGroupId: old.materialGroupId },
          _max: { versionNo: true },
        });
        if (current)
          await update(
            tx,
            "materials",
            current,
            { isCurrent: false },
            a,
            "新版本",
          );
        return update(
          tx,
          "materials",
          created,
          {
            materialGroupId: old.materialGroupId,
            versionNo: (max._max.versionNo ?? 0) + 1,
            // Metadata-only revisions keep the current file available.
            ...(!file
              ? {
                  storageKey: old.storageKey,
                  storageProvider: old.storageProvider,
                  originalName: old.originalName,
                  mimeType: old.mimeType,
                  sizeBytes: old.sizeBytes,
                  checksum: old.checksum,
                }
              : {}),
          },
          a,
          "资料版本更新",
        );
      });
    } catch (e) {
      await this.db.material.update({
        where: { id: created.id },
        data: { deletedAt: new Date(), storageKey: null },
      });
      if (file && created.storageKey)
        await this.storage.discard({
          storageProvider: created.storageProvider,
          storageKey: created.storageKey,
        });
      throw e;
    }
  }
}
