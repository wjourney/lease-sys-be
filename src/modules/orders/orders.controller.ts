import {
  Body,
  Controller,
  Delete,
  Get,
  Inject,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { sendFile } from "../../common/storage/file-response";
import { ContractsService } from "./contracts.service";
import { DepositSettlementService } from "./deposit-settlement.service";
import { OrderLifecycleService } from "./order-lifecycle.service";
import { OrdersService } from "./orders.service";
@ApiTags("orders")
@Controller("orders")
export class OrdersController {
  private readonly logger = new Logger(OrdersController.name);
  constructor(
    @Inject(OrdersService) private service: OrdersService,
    @Inject(OrderLifecycleService) private lifecycle: OrderLifecycleService,
    @Inject(DepositSettlementService)
    private deposits: DepositSettlementService,
    @Inject(ContractsService) private contracts: ContractsService,
  ) {}
  @Post(":id/close") close(@Req() r: any, @Param("id") key: string) {
    return this.lifecycle.close(r.actor, key);
  }
  @Post(":id/terminate") terminate(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.lifecycle.terminate(r.actor, key, d);
  }
  @Post(":id/handover") handover(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.lifecycle.handover(r.actor, key, d);
  }
  @Post(":id/deposit-settlement") deposit(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.deposits.deposit(r.actor, key, d);
  }
  @Post(":id/contract") contract(
    @Req() r: any,
    @Param("id") key: string,
    @Body() d: any,
  ) {
    return this.contracts.contract(r.actor, key, d.templateMaterialId);
  }
  @Post(":id/contract/ensure") async ensureContract(
    @Req() r: any,
    @Param("id") key: string,
  ) {
    const contract = await this.contracts.ensure(r.actor, key);
    return { id: contract.id };
  }
  @Get(":id/contract/download") async downloadContract(
    @Req() r: any,
    @Param("id") key: string,
    @Res() res: any,
  ) {
    const file = await this.contracts.download(r.actor, key);
    await sendFile(r, res, this.contracts.storage, file, "attachment");
  }
  @Get() list(@Req() r: any, @Query() q: any) {
    return this.service.list(r.actor, q);
  }
  @Get("export") async export(@Req() r: any, @Query() q: any, @Res() res: any) {
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="orders.csv"');
    res.send(await this.service.export(r.actor, q));
  }
  @Get(":id/operations") operations(@Req() r: any, @Param("id") id: string) {
    return this.service.operations(r.actor, id);
  }
  @Get(":id") detail(@Req() r: any, @Param("id") id: string) {
    return this.service.detail(r.actor, id);
  }
  @Post() async create(@Req() r: any, @Body() body: any) {
    const created = await this.service.create(r.actor, body);
    try {
      await this.contracts.ensure(r.actor, created.id);
    } catch (error) {
      this.logger.warn(
        `Order ${created.id} was created without a contract`,
        error,
      );
    }
    const result = await this.service.detail(r.actor, created.id);
    return {
      ...result,
      contractGenerationPending: !result.currentContractMaterialId,
    };
  }
  @Patch(":id") async edit(
    @Req() r: any,
    @Param("id") id: string,
    @Body() body: any,
  ) {
    await this.service.edit(r.actor, id, body);
    try {
      await this.contracts.ensure(r.actor, id);
    } catch (error) {
      this.logger.warn(
        `Order ${id} saved; contract generation needs retry`,
        error,
      );
    }
    return this.service.detail(r.actor, id);
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
