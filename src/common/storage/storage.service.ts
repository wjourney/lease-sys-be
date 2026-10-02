import {
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from "@nestjs/common";
import OSS from "ali-oss";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, stat, unlink, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Readable } from "node:stream";
import { PrismaService } from "../../database/prisma.service";

export interface StoredReference {
  storageProvider: string;
  storageKey: string;
}
export interface StoredFile extends StoredReference {
  sizeBytes: number;
  checksum: string;
}
export interface ByteRange {
  start: number;
  end: number;
}
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
export const checksum = (bytes: Buffer) =>
  createHash("sha256").update(bytes).digest("hex");

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(StorageService.name);
  private client?: OSS;
  private publicClient?: OSS;
  private timer?: NodeJS.Timeout;
  private cleaning = false;
  readonly provider = process.env.STORAGE_PROVIDER || "LOCAL";
  readonly prefix = process.env.OSS_PREFIX || "lease-sys/dev/";
  readonly root = resolve(process.env.UPLOAD_DIR || "uploads");
  constructor(@Inject(PrismaService) private readonly db: PrismaService) {
    if (!["LOCAL", "OSS"].includes(this.provider))
      throw new Error("Invalid STORAGE_PROVIDER");
    if (
      !/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/.test(this.prefix) ||
      this.prefix.length > 140
    )
      throw new Error("OSS_PREFIX must be an isolated directory ending in /");
    if (this.provider === "OSS") this.oss();
  }
  private oss() {
    if (this.client) return this.client;
    const {
      OSS_ENDPOINT,
      OSS_BUCKET,
      OSS_ACCESS_KEY_ID,
      OSS_ACCESS_KEY_SECRET,
      OSS_SECURITY_TOKEN,
    } = process.env;
    if (
      !OSS_ENDPOINT ||
      !OSS_BUCKET ||
      !OSS_ACCESS_KEY_ID ||
      !OSS_ACCESS_KEY_SECRET
    )
      throw new Error("OSS server credentials and endpoint must be configured");
    const url = new URL(OSS_ENDPOINT);
    if (url.protocol !== "https:")
      throw new Error("OSS_ENDPOINT must use HTTPS");
    this.client = new OSS({
      endpoint: OSS_ENDPOINT,
      bucket: OSS_BUCKET,
      region: process.env.OSS_REGION || "oss-cn-shanghai",
      accessKeyId: OSS_ACCESS_KEY_ID,
      accessKeySecret: OSS_ACCESS_KEY_SECRET,
      ...(OSS_SECURITY_TOKEN ? { stsToken: OSS_SECURITY_TOKEN } : {}),
      secure: true,
      timeout: 60000,
    });
    return this.client;
  }
  private publicOss() {
    if (this.publicClient) return this.publicClient;
    const internalEndpoint = new URL(process.env.OSS_ENDPOINT || "");
    const endpoint = new URL(
      process.env.OSS_PUBLIC_ENDPOINT ||
        internalEndpoint.href.replace(
          /-internal(?=\.aliyuncs\.com(?:\/|$))/,
          "",
        ),
    );
    if (
      endpoint.protocol !== "https:" ||
      !/^oss-[a-z0-9-]+\.aliyuncs\.com$/.test(endpoint.hostname)
    )
      throw new Error("OSS_PUBLIC_ENDPOINT must be a public HTTPS OSS endpoint");
    this.publicClient = new OSS({
      endpoint: endpoint.href,
      bucket: process.env.OSS_BUCKET!,
      region: process.env.OSS_REGION || "oss-cn-shanghai",
      accessKeyId: process.env.OSS_ACCESS_KEY_ID!,
      accessKeySecret: process.env.OSS_ACCESS_KEY_SECRET!,
      ...(process.env.OSS_SECURITY_TOKEN
        ? { stsToken: process.env.OSS_SECURITY_TOKEN }
        : {}),
      secure: true,
    });
    return this.publicClient;
  }
  async previewUrl(
    ref: StoredReference,
    fallbackUrl: string,
  ): Promise<string> {
    this.validate(ref);
    if (ref.storageProvider === "LOCAL") return fallbackUrl;
    try {
      return await this.publicOss().signatureUrlV4(
        "GET",
        3600,
        { headers: {} },
        ref.storageKey,
      );
    } catch (error) {
      return this.failure(error);
    }
  }
  private validate(ref: StoredReference) {
    const valid =
      ref.storageProvider === "LOCAL"
        ? uuid.test(ref.storageKey)
        : ref.storageProvider === "OSS" &&
          ref.storageKey.startsWith(this.prefix) &&
          uuid.test(ref.storageKey.slice(this.prefix.length));
    if (!valid) throw new NotFoundException("文件存储标识无效");
  }
  private failure(error: any): never {
    // Never expose an SDK error/request: it can contain signed URLs and credentials.
    if (error?.code === "ENOENT" || error?.code === "NoSuchKey")
      throw new NotFoundException("文件不存在");
    this.logger.error(
      `Storage operation failed (${String(error?.code || "UNKNOWN")
        .replace(/[^A-Za-z0-9_-]/g, "")
        .slice(0, 60)})`,
    );
    throw new ServiceUnavailableException("文件存储暂时不可用，请稍后重试");
  }
  async save(
    bytes: Buffer,
    mimeType = "application/octet-stream",
    provider = this.provider,
  ): Promise<StoredFile> {
    const file = {
      storageProvider: provider,
      storageKey: (provider === "OSS" ? this.prefix : "") + randomUUID(),
      sizeBytes: bytes.length,
      checksum: checksum(bytes),
    };
    this.validate(file);
    // Register before writing: even a timeout with an unknown upload result is recoverable.
    await this.db.storageCleanup.create({
      data: {
        storageProvider: file.storageProvider,
        storageKey: file.storageKey,
        deleteAfter: new Date(Date.now() + 86400000),
      },
    });
    try {
      if (provider === "LOCAL") {
        await mkdir(this.root, { recursive: true });
        await writeFile(resolve(this.root, file.storageKey), bytes, {
          flag: "wx",
        });
      } else {
        await this.oss().put(file.storageKey, bytes, {
          mime: mimeType,
          headers: {
            "x-oss-object-acl": "private",
            "x-oss-forbid-overwrite": "true",
            "x-oss-meta-sha256": file.checksum,
            "Cache-Control": "private, no-store",
          },
        });
      }
      return file;
    } catch (error) {
      return this.failure(error);
    }
  }
  async size(ref: StoredReference): Promise<number> {
    this.validate(ref);
    try {
      if (ref.storageProvider === "LOCAL")
        return (await stat(resolve(this.root, ref.storageKey))).size;
      const result = await this.oss().head(ref.storageKey);
      const value = Number(result.res.headers["content-length"]);
      if (!Number.isSafeInteger(value) || value < 0)
        throw new Error("Invalid object size");
      return value;
    } catch (error) {
      return this.failure(error);
    }
  }
  async open(ref: StoredReference, range?: ByteRange): Promise<Readable> {
    this.validate(ref);
    try {
      if (ref.storageProvider === "LOCAL")
        return createReadStream(resolve(this.root, ref.storageKey), range);
      const result = await this.oss().getStream(ref.storageKey, {
        headers: range ? { Range: `bytes=${range.start}-${range.end}` } : {},
      });
      if (
        range &&
        (result.res.status !== 206 ||
          Number(result.res.headers["content-length"]) !==
            range.end - range.start + 1)
      ) {
        result.stream.destroy();
        throw new Error("Invalid range response");
      }
      return result.stream;
    } catch (error) {
      return this.failure(error);
    }
  }
  async read(ref: StoredReference): Promise<Buffer> {
    const source = await this.open(ref);
    const chunks: Buffer[] = [];
    try {
      for await (const chunk of source) chunks.push(Buffer.from(chunk));
      return Buffer.concat(chunks);
    } catch (error) {
      return this.failure(error);
    }
  }
  async scheduleCleanup(input: StoredReference) {
    const ref = {
      storageProvider: input.storageProvider,
      storageKey: input.storageKey,
    };
    this.validate(ref);
    // Delay compensation so an uncertain DB commit can settle before checking references.
    const deleteAfter = new Date(Date.now() + 300000);
    await this.db.storageCleanup.upsert({
      where: { storageProvider_storageKey: ref },
      create: { ...ref, deleteAfter },
      update: { deleteAfter },
    });
  }
  async discard(ref: StoredReference) {
    try {
      await this.scheduleCleanup(ref);
    } catch {
      this.logger.error(
        "Could not expedite cleanup; registered upload will be checked after 24 hours",
      );
    }
  }
  async referenced(input: StoredReference) {
    const ref = {
      storageProvider: input.storageProvider,
      storageKey: input.storageKey,
    };
    const [materials, users] = await Promise.all([
      this.db.material.count({ where: ref }),
      this.db.user.count({
        where: {
          avatarStorageProvider: ref.storageProvider,
          avatarStorageKey: ref.storageKey,
        },
      }),
    ]);
    return materials + users > 0;
  }
  async collectGarbage() {
    if (this.cleaning) return;
    this.cleaning = true;
    try {
      const pending = await this.db.storageCleanup.findMany({
        where: { deleteAfter: { lte: new Date() } },
        take: 100,
        orderBy: { deleteAfter: "asc" },
      });
      for (const item of pending) {
        try {
          const ref = {
            storageProvider: item.storageProvider,
            storageKey: item.storageKey,
          };
          this.validate(ref);
          if (!(await this.referenced(ref))) {
            if (ref.storageProvider === "OSS")
              await this.oss().delete(ref.storageKey);
            else
              await unlink(resolve(this.root, ref.storageKey)).catch(
                (error) => {
                  if (error.code !== "ENOENT") throw error;
                },
              );
          }
          await this.db.storageCleanup.deleteMany({ where: { id: item.id } });
        } catch (error: any) {
          await this.db.storageCleanup.updateMany({
            where: { id: item.id },
            data: {
              attempts: { increment: 1 },
              lastError: String(error?.code || "STORAGE_ERROR")
                .replace(/[^A-Za-z0-9_-]/g, "")
                .slice(0, 100),
              deleteAfter: new Date(
                Date.now() +
                  Math.min(86400000, 300000 * 2 ** Math.min(item.attempts, 8)),
              ),
            },
          });
        }
      }
    } finally {
      this.cleaning = false;
    }
  }
  onModuleInit() {
    if (process.env.DISABLE_SCHEDULER === "true") return;
    this.timer = setInterval(() => {
      void this.collectGarbage().catch(() =>
        this.logger.error("Storage cleanup unavailable"),
      );
    }, 300000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
}
