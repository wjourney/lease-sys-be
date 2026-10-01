import { Module } from "@nestjs/common";
import { DatabaseModule } from "../../database/database.module";
import { StorageService } from "./storage.service";
import { PdfService } from "./pdf.service";
@Module({
  imports: [DatabaseModule],
  providers: [StorageService, PdfService],
  exports: [StorageService, PdfService],
})
export class StorageModule {}
