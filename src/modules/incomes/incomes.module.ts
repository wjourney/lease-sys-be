import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { FundAccountsModule } from "../fund-accounts/fund-accounts.module";
import { BillingModule } from "./billing.module";
import { IncomesController } from "./incomes.controller";
import { IncomesService } from "./incomes.service";
import { ReceiptsService } from "./receipts.service";
@Module({
  imports: [CommonModule, BillingModule, FundAccountsModule],
  controllers: [IncomesController],
  providers: [IncomesService, ReceiptsService],
  exports: [IncomesService, ReceiptsService],
})
export class IncomesModule {}
