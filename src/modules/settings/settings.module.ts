import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { SettingsController } from "./settings.controller";
import { SettingsService } from "./settings.service";
import { StorageModule } from "../../common/storage/storage.module";
import { WebsiteService } from "./website.service";
import { WebsiteController } from "./website.controller";
@Module({
  imports: [CommonModule, StorageModule],
  controllers: [SettingsController, WebsiteController],
  providers: [SettingsService, WebsiteService],
  exports: [SettingsService],
})
export class SettingsModule {}
