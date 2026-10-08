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
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ProjectsService } from "./projects.service";
@ApiTags("projects")
@Controller("projects")
export class ProjectsController {
  constructor(@Inject(ProjectsService) private service: ProjectsService) {}

  @Get() list(@Req() r: any, @Query() q: any) {
    return this.service.list(r.actor, q);
  }
  @Get("export") async export(@Req() r: any, @Query() q: any, @Res() res: any) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="projects.csv"');
    res.send(await this.service.export(r.actor, q));
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
  @Patch(":id/logos/order") orderLogos(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.orderLogos(r.actor, id, body);
  }
  @Patch(":id/images/order") orderImages(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    return this.service.orderImages(r.actor, id, body);
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
  @Delete() async remove(
    @Req() r: any,
    @Body() body: any,
  ) {
    const deleted = await this.service.removeMany(r.actor, body?.ids, body?.reason);
    return { ok: true, count: deleted.length };
  }
}
