import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { IncomesService } from "./incomes.service";
import { ReceiptsService } from "./receipts.service";
import { listOrderBills } from "./bill-list";
@ApiTags("incomes")
@Controller("incomes")
export class IncomesController {
  constructor(
    @Inject(IncomesService) private service: IncomesService,
    @Inject(ReceiptsService) private receiptsService: ReceiptsService,
  ) {}
  @Post("batch-receipts") batchReceipts(@Req() r: any, @Body() body: any) {
    return this.receiptsService.batchBills(r.actor, body);
  }
  @Get("bills") bills(@Req() r: any, @Query() q: any) {
    return listOrderBills(this.service.db, this.service.access, r.actor, q);
  }
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
  @Post(":id/withdraw") withdraw(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.receiptsService.undo(r.actor, key, d);
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
}
