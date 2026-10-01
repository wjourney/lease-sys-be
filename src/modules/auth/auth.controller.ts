import { Body, Controller, Get, Inject, Patch, Post, Req, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AuthService } from "./auth.service";
import { sessionCookieOptions } from "./jwt.config";
import { Public } from "./public.decorator";
@ApiTags("认证")
@Controller("auth")
export class AuthController {
  constructor(@Inject(AuthService) private service: AuthService) {}
  @Public() @Post("login") async login(
    @Body() body: any,
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    const result = await this.service.login(body, req.ip, req.headers.origin);
    res.cookie("lease_session", result.token, {
      ...sessionCookieOptions,
      httpOnly: true,
    });
    res.cookie("lease_csrf", result.csrf, {
      ...sessionCookieOptions,
      httpOnly: false,
    });
    return result.profile;
  }
  @Get("me") me(@Req() req: any) {
    return this.service.profile(req.actor);
  }
  @Patch("me") updateMe(@Req() req: any, @Body() body: any) {
    return this.service.updateProfile(req.actor, body);
  }
  @Post("logout") async logout(
    @Req() req: any,
    @Res({ passthrough: true }) res: any,
  ) {
    await this.service.logout(req.actor.id);
    res.clearCookie("lease_session", { path: "/" });
    res.clearCookie("lease_csrf", { path: "/" });
    return { ok: true };
  }
  @Post("password") password(@Req() req: any, @Body() body: any) {
    return this.service.password(req.actor, body);
  }
}
