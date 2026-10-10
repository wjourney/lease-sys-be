import { IncomesModule } from "../incomes/incomes.module";
import { DepositsService } from "./deposits.service";
import { OrderDetailService } from "./order-detail.service";
import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { StorageModule } from "../../common/storage/storage.module";
import { BillingModule } from "../incomes/billing.module";
import { ContractsService } from "./contracts.service";
import { DepositSettlementService } from "./deposit-settlement.service";
import { OrderLifecycleService } from "./order-lifecycle.service";
import { OrdersController } from "./orders.controller";
import { OrdersService } from "./orders.service";
@Module({
  imports: [CommonModule, BillingModule, StorageModule, IncomesModule],
  controllers: [OrdersController],
  providers: [
    DepositsService,
    OrderDetailService,
    OrdersService,
    OrderLifecycleService,
    DepositSettlementService,
    ContractsService,
  ],
  exports: [
    DepositsService,
    OrderDetailService,
    OrdersService,
    OrderLifecycleService,
    DepositSettlementService,
    ContractsService,
  ],
})
export class OrdersModule {}
