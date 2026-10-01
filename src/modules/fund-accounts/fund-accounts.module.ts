import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { AccountValidationService } from "./account-validation.service";
import { FundAccountsController } from "./fund-accounts.controller";
import { FundAccountsService } from "./fund-accounts.service";
@Module({
  imports: [CommonModule],
  controllers: [FundAccountsController],
  providers: [FundAccountsService, AccountValidationService],
  exports: [FundAccountsService, AccountValidationService],
})
export class FundAccountsModule {}
