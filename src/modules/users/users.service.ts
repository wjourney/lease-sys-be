import { sendFile } from "../../common/storage/file-response";
import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { hashPassword } from "../../common/auth/password";
import { lock, update } from "../../common/database/record-mutations";
import { ResourceService } from "../../common/resources/resource.service";
import { StorageService } from "../../common/storage/storage.service";
import { demand, fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { UsersSchema } from "./dto/users.schema";
@Injectable()
export class UsersService extends ResourceService {
  readonly resource = "users";
  protected schema = UsersSchema;
  protected references: [string, string][] = [
    ["order", "salesUserId"],
    ["commission", "salesUserId"],
  ];
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
    @Inject(StorageService)
    private storage: StorageService,
  ) {
    super(db, access);
  }
  private initialPassword() {
    return `Sb${randomBytes(9).toString("base64url")}`;
  }
  private assertCanDisable(a: Actor, row: any) {
    demand(a.role === "SUPER_ADMIN", "只有超级管理员可以停用账号");
    if (row.id === a.id) fail("不能停用自己的账号");
    demand(row.role !== "SUPER_ADMIN", "不能停用超级管理员账号");
  }
  async uploadAvatar(a: Actor, key: string, file?: Express.Multer.File) {
    if (key !== a.id) this.access.allow(a, this.resource, true);
    await this.access.get(a, this.resource, key);
    if (!file) return fail("请选择小于 2MB 的头像图片");
    if (!file.buffer || file.size > 2 * 1024 * 1024)
      return fail("请选择小于 2MB 的头像图片");
    const bytes = file.buffer;
    const mimeType =
      bytes[0] === 0x89 && bytes.subarray(1, 4).toString() === "PNG"
        ? "image/png"
        : bytes[0] === 0xff && bytes[1] === 0xd8
          ? "image/jpeg"
          : bytes.subarray(0, 4).toString() === "RIFF" &&
              bytes.subarray(8, 12).toString() === "WEBP"
            ? "image/webp"
            : null;
    if (!mimeType) return fail("头像仅支持 JPG、PNG 或 WebP 图片");
    const stored = await this.storage.save(bytes, mimeType);
    let result: any;
    try {
      result = await this.db.$transaction(async (tx) => {
        await lock(tx, this.resource, key);
        const current = await this.access.get(a, this.resource, key, tx);
        const row = await update(
          tx,
          this.resource,
          current,
          {
            avatarStorageKey: stored.storageKey,
            avatarStorageProvider: stored.storageProvider,
            avatarMimeType: mimeType,
          },
          a,
          "更新头像",
        );
        if (current.avatarStorageKey) {
          const old = {
            storageProvider: current.avatarStorageProvider,
            storageKey: current.avatarStorageKey,
          };
          await tx.storageCleanup.upsert({
            where: { storageProvider_storageKey: old },
            create: { ...old, deleteAfter: new Date(Date.now() + 300000) },
            update: { deleteAfter: new Date(Date.now() + 300000) },
          });
        }
        return row;
      });
    } catch (cause) {
      await this.storage.discard(stored);
      throw cause;
    }
    return this.enrich(a, result);
  }
  async avatar(a: Actor, key: string) {
    const row = await this.access.get(a, this.resource, key);
    if (!row.avatarStorageKey) fail("该账号尚未上传头像");
    return {
      storageProvider: row.avatarStorageProvider,
      storageKey: row.avatarStorageKey,
      type: row.avatarMimeType || "image/png",
      name: "avatar",
    };
  }
  async sendAvatar(a: Actor, key: string, req: any, res: any) {
    await sendFile(req, res, this.storage, await this.avatar(a, key));
  }
  async createMember(a: Actor, body: any) {
    const phone = typeof body?.phone === "string" ? body.phone.trim() : "";
    if (!/^\d{8,20}$/.test(phone)) fail("请输入 8 至 20 位数字手机号");
    if (body?.username !== undefined && body.username !== phone)
      fail("登录账号必须与手机号一致");
    const generated = !body?.password;
    const initialPassword = generated ? this.initialPassword() : body.password;
    let row: any;
    try {
      row = await super.create(a, {
        ...body,
        username: phone,
        phone,
        password: initialPassword,
      });
    } catch (cause) {
      if (
        cause instanceof Prisma.PrismaClientKnownRequestError &&
        cause.code === "P2002"
      )
        throw new ConflictException("该手机号已被用作登录账号");
      throw cause;
    }
    return {
      ...(await this.enrich(a, row)),
      ...(generated ? { initialPassword } : {}),
    };
  }
  async resetInitialPassword(a: Actor, key: string) {
    this.access.allow(a, this.resource, true);
    const initialPassword = this.initialPassword();
    await this.db.$transaction(async (tx) => {
      await lock(tx, this.resource, key);
      const row = await this.access.get(a, this.resource, key, tx);
      if (row.id === a.id) fail("请通过个人中心修改自己的密码");
      await update(
        tx,
        this.resource,
        row,
        {
          passwordHash: hashPassword(initialPassword),
          authVersion: row.authVersion + 1,
        },
        a,
        "重置初始密码",
      );
    });
    return { initialPassword };
  }
  async disableAccount(a: Actor, key: string, body: any) {
    this.access.allow(a, this.resource, true);
    const { reason } = z
      .object({ reason: z.string().trim().min(1).max(500) })
      .strict()
      .parse(body);
    const row = await this.db.$transaction(async (tx) => {
      await lock(tx, this.resource, key);
      const current = await this.access.get(a, this.resource, key, tx);
      this.assertCanDisable(a, current);
      if (current.status === "DISABLED") fail("账号已停用");
      return update(
        tx,
        this.resource,
        current,
        {
          status: "DISABLED",
          authVersion: current.authVersion + 1,
        },
        a,
        reason,
      );
    });
    return this.enrich(a, row);
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    if (row && data.username !== undefined && data.username !== row.username)
      fail("登录账号不能在资料编辑中修改");
    if (
      row &&
      row.username === row.phone &&
      data.phone !== undefined &&
      data.phone !== row.phone
    )
      fail("登录手机号暂不支持在资料编辑中修改");
    const combined = {
      ...row,
      ...data,
    };
    demand(
      combined.role !== "SUPER_ADMIN" || combined.status !== "DISABLED",
      "不能停用超级管理员账号",
    );
    if (row && row.status !== "DISABLED" && data.status === "DISABLED")
      this.assertCanDisable(a, row);
    if (a.role === "SALES_COMPANY_ADMIN") {
      demand(!row || row.id !== a.id, "不能修改自己的角色或状态");
      demand(["SALES"].includes(combined.role), "只能维护本公司销售员工");
      data.salesCompanyId = a.salesCompanyId;
    }
    if (["SALES", "SALES_COMPANY_ADMIN"].includes(combined.role)) {
      if (!data.salesCompanyId && !row?.salesCompanyId)
        fail("销售账号必须关联公司");
      const c = await this.access.get(
        a,
        "sales-companies",
        data.salesCompanyId ?? row.salesCompanyId,
        tx,
      );
      for (const [field, collection] of [
        ["branchCode", "branches"],
        ["positionCode", "positions"],
      ])
        if (
          combined[field] &&
          !(c[collection] as any[]).some(
            (x) => x.code === combined[field] && x.enabled,
          )
        )
          fail("分行或职位选项无效");
    } else data.salesCompanyId = null;
    if (data.password) {
      data.passwordHash = hashPassword(data.password);
      delete data.password;
    }
    if (
      row &&
      (data.passwordHash ||
        data.role ||
        data.status ||
        data.salesCompanyId !== undefined)
    )
      data.authVersion = row.authVersion + 1;
    if (
      row?.id === a.id &&
      (data.status === "DISABLED" || (data.role && data.role !== row.role))
    )
      fail("不能停用自己或修改自己的角色");
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    if (row.id === a.id) fail("不能删除自己的账号");
    if (row.role === "SUPER_ADMIN") fail("不能删除超级管理员账号");
  }
}
