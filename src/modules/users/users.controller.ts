import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseInterceptors,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { ApiTags } from "@nestjs/swagger";
import { UsersService } from "./users.service";
@ApiTags("users")
@Controller("users")
export class UsersController {
  constructor(@Inject(UsersService) private service: UsersService) {}

  @Get() list(@Req() r: any, @Query() q: any) {
    return this.service.list(r.actor, q);
  }
  @Get("export") async export(@Req() r: any, @Query() q: any, @Res() res: any) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="users.csv"');
    res.send(await this.service.export(r.actor, q));
  }
  @Get(":id/operations") operations(@Req() r: any, @Param("id") id: string) {
    return this.service.operations(r.actor, id);
  }
  @Get(":id/avatar") async avatar(
    @Req() r: any,
    @Param("id") id: string,
    @Res() res: any,
  ) {
    const avatar = await this.service.avatar(r.actor, id);
    res.setHeader("Content-Type", avatar.type);
    res.setHeader("Cache-Control", "private, no-store");
    res.send(avatar.buffer);
  }
  @Post(":id/avatar")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 2 * 1024 * 1024, files: 1 },
    }),
  )
  uploadAvatar(
    @Req() r: any,
    @Param("id") id: string,
    @UploadedFile() file: Express.Multer.File,
  ) {
    return this.service.uploadAvatar(r.actor, id, file);
  }
  @Get(":id") detail(@Req() r: any, @Param("id") id: string) {
    return this.service.detail(r.actor, id);
  }
  @Post() async create(@Req() r: any, @Body() body: any) {
    return this.service.createMember(r.actor, body);
  }
  @Post(":id/reset-password") resetPassword(
    @Req() r: any,
    @Param("id") id: string,
  ) {
    return this.service.resetInitialPassword(r.actor, id);
  }
  @Post(":id/disable") disable(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.disableAccount(r.actor, id, body);
  }
  @Patch(":id") async edit(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.enrich(
      r.actor,
      await this.service.edit(r.actor, id, body),
    );
  }
  @Delete(":id") async remove(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    await this.service.remove(r.actor, id, body.reason);
    return { ok: true };
  }
}
