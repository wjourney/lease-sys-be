import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { FundAccountsModule } from "../fund-accounts/fund-accounts.module";
import { CommissionLedgerModule } from "./commission-ledger.module";
import { CommissionPaymentsService } from "./commission-payments.service";
import { CommissionsController } from "./commissions.controller";
import { CommissionsService } from "./commissions.service";
import { CompanyCommissionsController } from "./company-commissions.controller";
import { CompanyCommissionsService } from "./company-commissions.service";
@Module({
  imports: [CommonModule, FundAccountsModule, CommissionLedgerModule],
  controllers: [CommissionsController, CompanyCommissionsController],
  providers: [
    CommissionsService,
    CommissionPaymentsService,
    CompanyCommissionsService,
  ],
  exports: [CommissionsService, CommissionPaymentsService],
})
export class CommissionsModule {}
