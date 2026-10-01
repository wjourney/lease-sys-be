import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import jwt from "jsonwebtoken";
import { PrismaService } from "../../database/prisma.service";
import { accountExpired } from "../../common/auth/account-expiry";
import { secret } from "./jwt.config";
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(PrismaService) private db: PrismaService,
    @Inject(Reflector) private reflector: Reflector,
  ) {}
  async canActivate(ctx: ExecutionContext) {
    if (
      this.reflector.getAllAndOverride("public", [
        ctx.getHandler(),
        ctx.getClass(),
      ])
    )
      return true;
    const req = ctx.switchToHttp().getRequest();
    try {
      const token = req.cookies?.lease_session;
      const payload = jwt.verify(token, secret(), {
        algorithms: ["HS256"],
        issuer: "lease-sys",
      }) as any;
      const a = await this.db.user.findUnique({ where: { id: payload.sub } });
      if (
        !a ||
        a.deletedAt ||
        a.status !== "ACTIVE" ||
        a.authVersion !== payload.v ||
        accountExpired(a.expiresAt)
      )
        throw new Error();
      if (a.salesCompanyId) {
        const c = await this.db.salesCompany.findUnique({
          where: { id: a.salesCompanyId },
        });
        if (
          !c ||
          c.deletedAt ||
          c.status !== "ACTIVE" ||
          (c.serviceEndsOn && c.serviceEndsOn.getTime() + 86400000 < Date.now())
        )
          throw new Error();
      }
      req.actor = a;
    } catch {
      throw new UnauthorizedException("请重新登录");
    }
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method)) {
      if (
        !req.cookies.lease_csrf ||
        req.headers["x-csrf-token"] !== req.cookies.lease_csrf
      )
        throw new ForbiddenException("请求校验失败，请刷新页面");
      const origin = req.headers.origin;
      const allowed = (process.env.APP_ORIGIN || "http://localhost:5173").split(
        ",",
      );
      if (origin && !allowed.includes(origin))
        throw new ForbiddenException("请求来源不被允许");
    }
    return true;
  }
}
