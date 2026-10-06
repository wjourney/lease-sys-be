import { Controller, Get, Inject, Req, Res } from "@nestjs/common";
import { Public } from "../auth/public.decorator";
import { WebsiteService } from "./website.service";
@Controller("site-config")
export class WebsiteController {
  constructor(@Inject(WebsiteService) private service: WebsiteService) {}
  @Public() @Get() read(@Res({ passthrough: true }) res: any) {
    res.setHeader("Cache-Control", "no-store");
    return this.service.read();
  }
  @Public() @Get("logo") logo(@Req() req: any, @Res() res: any) {
    return this.service.sendLogo(req, res);
  }
}
