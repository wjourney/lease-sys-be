import { Controller, Get, Inject, Module, Query, Req } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { FinanceService } from "./finance.service";

@Controller("finance")
export class FinanceController {
  constructor(@Inject(FinanceService) private service: FinanceService) {}
  @Get("ledger") ledger(@Req() req: any, @Query() query: any) {
    return this.service.ledger(req.actor, query);
  }
  @Get("statistics") statistics(@Req() req: any, @Query() query: any) {
    return this.service.statistics(req.actor, query);
  }
}
@Module({
  imports: [CommonModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
