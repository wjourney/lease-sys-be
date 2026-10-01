import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { CommissionBalanceService } from "./commission-balance.service";
@Module({
  imports: [CommonModule],
  providers: [CommissionBalanceService],
  exports: [CommissionBalanceService],
})
export class CommissionLedgerModule {}
