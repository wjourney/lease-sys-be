import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { StorageModule } from "../../common/storage/storage.module";
import { ProjectsController } from "./projects.controller";
import { ProjectsService } from "./projects.service";
@Module({
  imports: [CommonModule, StorageModule],
  controllers: [ProjectsController],
  providers: [ProjectsService],
  exports: [ProjectsService],
})
export class ProjectsModule {}
