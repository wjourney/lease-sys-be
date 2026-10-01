import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { IncomeBalanceService } from "./income-balance.service";
import { RentBillingService } from "./rent-billing.service";
@Module({
  imports: [CommonModule],
  providers: [IncomeBalanceService, RentBillingService],
  exports: [IncomeBalanceService, RentBillingService],
})
export class BillingModule {}
