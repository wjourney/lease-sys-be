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
import { UnitsService } from "./units.service";
@ApiTags("units")
@Controller("units")
export class UnitsController {
  constructor(@Inject(UnitsService) private service: UnitsService) {}

  @Get() list(@Req() r: any, @Query() q: any) {
    return this.service.list(r.actor, q);
  }
  @Get("export") async export(@Req() r: any, @Query() q: any, @Res() res: any) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="units.csv"');
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
  @Post("batch-preview") previewBatch(@Req() r: any, @Body() body: any) {
    return this.service.batch(r.actor, body, true);
  }
  @Post("batch") createBatch(@Req() r: any, @Body() body: any) {
    return this.service.batch(r.actor, body);
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
