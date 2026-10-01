import { Module } from "@nestjs/common";
import { LocalStorageService } from "./local-storage.service";
import { PdfService } from "./pdf.service";
@Module({
  providers: [LocalStorageService, PdfService],
  exports: [LocalStorageService, PdfService],
})
export class StorageModule {}
