import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { StorageModule } from "../../common/storage/storage.module";
import { InvoiceEmailService } from "./invoice-email.service";
import { InvoiceLifecycleService } from "./invoice-lifecycle.service";
import { InvoiceRenderService } from "./invoice-render.service";
import { InvoicesController } from "./invoices.controller";
import { InvoicesService } from "./invoices.service";
@Module({
  imports: [CommonModule, StorageModule],
  controllers: [InvoicesController],
  providers: [
    InvoicesService,
    InvoiceRenderService,
    InvoiceEmailService,
    InvoiceLifecycleService,
  ],
  exports: [
    InvoicesService,
    InvoiceRenderService,
    InvoiceEmailService,
    InvoiceLifecycleService,
  ],
})
export class InvoicesModule {}
