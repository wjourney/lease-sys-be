import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { StorageModule } from "../../common/storage/storage.module";
import { MaterialFilesService } from "./material-files.service";
import { MaterialsController } from "./materials.controller";
import { MaterialsService } from "./materials.service";
@Module({
  imports: [CommonModule, StorageModule],
  controllers: [MaterialsController],
  providers: [MaterialsService, MaterialFilesService],
  exports: [MaterialsService, MaterialFilesService],
})
export class MaterialsModule {}
