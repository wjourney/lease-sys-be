import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { BillingModule } from "../incomes/billing.module";
import { InvoicesModule } from "../invoices/invoices.module";
import { JobsController } from "./jobs.controller";
import { JobsService } from "./jobs.service";
import { TasksService } from "./tasks.service";
@Module({
  imports: [CommonModule, BillingModule, InvoicesModule],
  providers: [JobsService, TasksService],
  controllers: [JobsController],
  exports: [JobsService],
})
export class JobsModule {}
