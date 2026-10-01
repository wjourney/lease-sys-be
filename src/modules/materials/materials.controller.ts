import { sendFile } from "../../common/storage/file-response";
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
import { AccessService } from "../../common/auth/access.service";
import { MaterialFilesService } from "./material-files.service";
import { MaterialsService } from "./materials.service";
@ApiTags("materials")
@Controller("materials")
export class MaterialsController {
  constructor(
    @Inject(MaterialsService) private service: MaterialsService,
    @Inject(MaterialFilesService) private files: MaterialFilesService,
    @Inject(AccessService) private access: AccessService,
  ) {}
  @Post("upload")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 30 * 1024 * 1024, files: 1 },
    }),
  )
  upload(
    @Req() r: any,
    @Body() d: any,
    @UploadedFile() f: Express.Multer.File,
  ) {
    return this.files.upload(r.actor, JSON.parse(d.payload || "{}"), f);
  }
  @Get(":id/versions") async versions(@Req() r: any, @Param("id") key: string) {
    const m = await this.access.get(r.actor, "materials", key);
    return this.service.list(r.actor, {
      materialGroupId: m.materialGroupId,
      current: "false",
      pageSize: 100,
    });
  }
  @Post(":id/versions")
  @UseInterceptors(
    FileInterceptor("file", {
      limits: { fileSize: 30 * 1024 * 1024, files: 1 },
    }),
  )
  version(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
    @UploadedFile() f: Express.Multer.File,
  ) {
    return this.files.version(r.actor, key, JSON.parse(d.payload || "{}"), f);
  }
  @Get(":id/download") async download(
    @Req() r: any,
    @Param("id") key: string,
    @Query("download") download: string | undefined,
    @Res() res: any,
  ) {
    const f = await this.files.download(r.actor, key);
    await sendFile(
      r,
      res,
      this.files.storage,
      f,
      download === "1" ? "attachment" : "inline",
    );
  }

  @Get() list(@Req() r: any, @Query() q: any) {
    return this.service.list(r.actor, q);
  }
  @Get("export") async export(@Req() r: any, @Query() q: any, @Res() res: any) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="materials.csv"',
    );
    res.send(await this.service.export(r.actor, q));
  }
  @Get(":id/operations") operations(@Req() r: any, @Param("id") id: string) {
    return this.service.operations(r.actor, id);
  }
  @Get(":id") detail(@Req() r: any, @Param("id") id: string) {
    return this.service.detail(r.actor, id);
  }
  @Post() async create(@Req() r: any, @Body() body: any) {
    return this.service.enrich(
      r.actor,
      await this.service.create(r.actor, body),
    );
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
