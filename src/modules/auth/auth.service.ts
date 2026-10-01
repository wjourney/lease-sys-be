import {
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import jwt from "jsonwebtoken";
import { randomBytes } from "node:crypto";
import { z } from "zod";
import { hashPassword, verifyPassword } from "../../common/auth/password";
import { accountExpired } from "../../common/auth/account-expiry";
import { capabilities } from "../../common/auth/permissions";
import { lock, update } from "../../common/database/record-mutations";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { secret } from "./jwt.config";
const attempts = new Map<
  string,
  {
    count: number;
    until: number;
  }
>();
@Injectable()
export class AuthService {
  constructor(
    @Inject(PrismaService)
    private db: PrismaService,
  ) {}
  async login(body: any, ip: string, originHeader?: string) {
    const data = z
      .object({
        username: z.string().min(1),
        password: z.string().min(1).max(128),
      })
      .strict()
      .parse(body);
    const origin = originHeader;
    if (
      origin &&
      !(process.env.APP_ORIGIN || "http://localhost:5173")
        .split(",")
        .includes(origin)
    )
      throw new ForbiddenException("请求来源不被允许");
    const key = ip + ":" + data.username;
    const t = attempts.get(key);
    if (t && t.until > Date.now() && t.count >= 10)
      throw new ForbiddenException("尝试过多，请 15 分钟后重试");
    const user = await this.db.user.findUnique({
      where: {
        username: data.username,
      },
    });
    const c = user?.salesCompanyId
      ? await this.db.salesCompany.findUnique({
          where: {
            id: user.salesCompanyId,
          },
        })
      : null;
    if (
      !user ||
      !verifyPassword(data.password, user.passwordHash) ||
      user.deletedAt ||
      user.status !== "ACTIVE" ||
      accountExpired(user.expiresAt) ||
      (user.salesCompanyId &&
        (!c ||
          c.status !== "ACTIVE" ||
          c.deletedAt ||
          (c.serviceEndsOn &&
            c.serviceEndsOn.getTime() + 86400000 < Date.now())))
    ) {
      attempts.set(key, {
        count: t && t.until > Date.now() ? t.count + 1 : 1,
        until: Date.now() + 900000,
      });
      throw new UnauthorizedException("账号、密码或账号有效状态不正确");
    }
    attempts.delete(key);
    await this.db.user.update({
      where: {
        id: user.id,
      },
      data: {
        lastLoginAt: new Date(),
      },
    });
    const csrf = randomBytes(32).toString("hex");
    return {
      profile: this.profile(user),
      csrf,
      token: jwt.sign(
        {
          sub: user.id,
          v: user.authVersion,
        },
        secret(),
        {
          expiresIn: "8h",
          issuer: "lease-sys",
        },
      ),
    };
  }
  profile(u: any) {
    return {
      id: u.id,
      name: u.name,
      nameEn: u.nameEn,
      avatarUrl: u.avatarStorageKey ? `/api/v1/users/${u.id}/avatar` : null,
      username: u.username,
      role: u.role,
      salesCompanyId: u.salesCompanyId,
      phone: u.phone,
      email: u.email,
      capabilities: capabilities(u),
    };
  }
  async updateProfile(actor: any, body: any) {
    const data = z
      .object({
        name: z.string().trim().min(1).max(500),
        nameEn: z.string().trim().max(3000),
        phone: z.string().trim().max(500),
        email: z.union([z.literal(""), z.string().trim().email()]),
      })
      .strict()
      .parse(body);
    const updated = await this.db.$transaction(async (tx) => {
      await lock(tx, "users", actor.id);
      const current = await tx.user.findUnique({ where: { id: actor.id } });
      if (!current || current.deletedAt || current.status !== "ACTIVE")
        throw new UnauthorizedException("账号不可用");
      if (current.username === current.phone && data.phone !== current.phone)
        fail("登录手机号暂不支持在个人资料中修改");
      return update(tx, "users", current, data, actor, "个人中心修改资料");
    });
    return this.profile(updated);
  }
  async logout(id: string) {
    await this.db.user.update({
      where: {
        id,
      },
      data: {
        authVersion: {
          increment: 1,
        },
      },
    });
  }
  async password(actor: any, body: any) {
    const d = z
      .object({
        currentPassword: z.string(),
        password: z.string().min(10).max(128),
      })
      .strict()
      .parse(body);
    if (!verifyPassword(d.currentPassword, actor.passwordHash))
      throw new ForbiddenException("当前密码不正确");
    await this.db.$transaction((tx) =>
      update(
        tx,
        "users",
        actor,
        {
          passwordHash: hashPassword(d.password),
          authVersion: actor.authVersion + 1,
        },
        actor,
        "修改密码",
      ),
    );
    return {
      ok: true,
    };
  }
}
