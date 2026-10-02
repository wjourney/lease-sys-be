import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { StorageModule } from "../../common/storage/storage.module";
import { UnitsController } from "./units.controller";
import { UnitsService } from "./units.service";
@Module({
  imports: [CommonModule, StorageModule],
  controllers: [UnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}
