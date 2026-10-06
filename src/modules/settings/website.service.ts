import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { insert, lock, update } from "../../common/database/record-mutations";
import { StorageService } from "../../common/storage/storage.service";
import { sendFile } from "../../common/storage/file-response";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
export const websiteDefaults = {
  siteName: "SUPREME BAY",
  subtitle: "租赁管理系统",
  browserTitle: "SUPREME BAY · 租赁管理系统",
  footer: "SUPREME BAY · 租赁管理系统",
};
export const WebsiteInput = z
  .object({
    revision: z.number().int().nonnegative(),
    siteName: z.string().trim().min(1).max(60),
    subtitle: z.string().trim().max(80),
    browserTitle: z.string().trim().min(1).max(100),
    footer: z.string().trim().max(200),
    removeLogo: z.boolean().optional(),
  })
  .strict();
export function logoMime(bytes: Buffer) {
  if (bytes.length < 12) return null;
  if (
    bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  )
    return "image/png";
  if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255)
    return "image/jpeg";
  if (
    bytes.subarray(0, 4).toString() === "RIFF" &&
    bytes.subarray(8, 12).toString() === "WEBP"
  )
    return "image/webp";
  return null;
}
@Injectable()
export class WebsiteService {
  constructor(
    @Inject(PrismaService) private db: PrismaService,
    @Inject(AccessService) private access: AccessService,
    @Inject(StorageService) private storage: StorageService,
  ) {}
  private async row() {
    return this.db.systemSetting.findUnique({ where: { key: "website" } });
  }
  async read() {
    const row = await this.row();
    const value: any = row?.value ?? {};
    // Public response is an explicit allowlist, never arbitrary settings or storage metadata.
    return {
      siteName: value.siteName ?? websiteDefaults.siteName,
      subtitle: value.subtitle ?? websiteDefaults.subtitle,
      browserTitle: value.browserTitle ?? websiteDefaults.browserTitle,
      footer: value.footer ?? websiteDefaults.footer,
      revision: row?.revision ?? 0,
      logoUrl: value.logo?.storageKey
        ? await this.storage.previewUrl(
            value.logo,
            `/api/v1/site-config/logo?v=${row?.revision}`,
          )
        : null,
    };
  }
  async adminRead(a: Actor) {
    this.access.allow(a, "settings", true);
    return this.read();
  }
  async save(a: Actor, body: unknown, file?: Express.Multer.File) {
    this.access.allow(a, "settings", true);
    let parsed = body;
    if (typeof body === "string") {
      try {
        parsed = JSON.parse(body);
      } catch {
        fail("网站配置格式无效");
      }
    }
    const { revision, removeLogo, ...fields } = WebsiteInput.parse(parsed);
    if (file && removeLogo) fail("请勿同时上传和移除网站 Logo");
    const mime = file ? logoMime(file.buffer) : null;
    if (file && (file.size > 2 * 1024 * 1024 || !mime))
      fail("网站 Logo 仅支持 2MB 以内的 PNG、JPG、WebP 图片");
    const stored = file
      ? await this.storage.save(file.buffer, mime!)
      : undefined;
    try {
      await this.db.$transaction(async (tx) => {
        let row = await tx.systemSetting.findUnique({
          where: { key: "website" },
        });
        if (row) {
          await lock(tx, "settings", row.id);
          row = await tx.systemSetting.findUnique({
            where: { key: "website" },
          });
        }
        if ((row?.revision ?? 0) !== revision)
          throw new ConflictException("网站配置已更新，请刷新后重试");
        const old: any = row?.value ?? {};
        const logo = stored
          ? {
              storageProvider: stored.storageProvider,
              storageKey: stored.storageKey,
              mimeType: mime,
            }
          : removeLogo
            ? null
            : (old.logo ?? null);
        const value = { ...fields, logo };
        if (row)
          await update(tx, "settings", row, { value }, a, "更新网站配置");
        else await insert(tx, "settings", { key: "website", value }, a);
        if ((stored || removeLogo) && old.logo?.storageKey) {
          const ref = {
            storageProvider: old.logo.storageProvider,
            storageKey: old.logo.storageKey,
          };
          await tx.storageCleanup.upsert({
            where: { storageProvider_storageKey: ref },
            create: { ...ref, deleteAfter: new Date(Date.now() + 300000) },
            update: { deleteAfter: new Date(Date.now() + 300000) },
          });
        }
      });
    } catch (error: any) {
      if (stored) await this.storage.discard(stored);
      if (error?.code === "P2002")
        throw new ConflictException("网站配置已更新，请刷新后重试");
      throw error;
    }
    return this.read();
  }
  async sendLogo(req: any, res: any) {
    const value: any = (await this.row())?.value;
    if (!value?.logo?.storageKey) throw new NotFoundException();
    await sendFile(req, res, this.storage, {
      ...value.logo,
      type: value.logo.mimeType,
      name: "website-logo",
    });
  }
}
