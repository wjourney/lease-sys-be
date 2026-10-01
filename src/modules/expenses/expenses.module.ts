import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { CommissionLedgerModule } from "../commissions/commission-ledger.module";
import { FundAccountsModule } from "../fund-accounts/fund-accounts.module";
import { ExpensesController } from "./expenses.controller";
import { ExpensesService } from "./expenses.service";
import { PaymentsService } from "./payments.service";
@Module({
  imports: [CommonModule, FundAccountsModule, CommissionLedgerModule],
  controllers: [ExpensesController],
  providers: [ExpensesService, PaymentsService],
  exports: [ExpensesService, PaymentsService],
})
export class ExpensesModule {}
