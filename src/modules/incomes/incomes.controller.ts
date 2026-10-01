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
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IncomesService } from "./incomes.service";
import { ReceiptsService } from "./receipts.service";
@ApiTags("incomes")
@Controller("incomes")
export class IncomesController {
  constructor(
    @Inject(IncomesService) private service: IncomesService,
    @Inject(ReceiptsService) private receiptsService: ReceiptsService,
  ) {}
  @Get(":id/receipts") receipts(
    @Req() r: any,
    @Param("id") key: string,
    @Query() q: any,
  ) {
    return this.service.list(r.actor, { ...q, parentId: key });
  }
  @Post(":id/receipts")
  @ApiOperation({ summary: "登记收款，同表创建 RECEIPT" })
  receipt(@Req() r: any, @Param("id") key: string, @Body() d: any) {
    return this.receiptsService.receipt(r.actor, key, d);
  }
  @Post(":id/confirm") confirm(@Req() r: any, @Param("id") key: string) {
    return this.receiptsService.confirm(r.actor, key, true);
  }
  @Post(":id/reject") reject(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.receiptsService.confirm(r.actor, key, false, d.reason);
  }
  @Post(":id/adjust") adjust(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.service.adjust(r.actor, key, d);
  }
  @Get() list(@Req() r: any, @Query() q: any) {
    return this.service.list(r.actor, q);
  }
  @Get("export") async export(@Req() r: any, @Query() q: any, @Res() res: any) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="incomes.csv"');
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
