import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { FundAccountsModule } from "../fund-accounts/fund-accounts.module";
import { CommissionLedgerModule } from "./commission-ledger.module";
import { CommissionPaymentsService } from "./commission-payments.service";
import { CommissionsController } from "./commissions.controller";
import { CommissionsService } from "./commissions.service";
@Module({
  imports: [CommonModule, FundAccountsModule, CommissionLedgerModule],
  controllers: [CommissionsController],
  providers: [CommissionsService, CommissionPaymentsService],
  exports: [CommissionsService, CommissionPaymentsService],
})
export class CommissionsModule {}
