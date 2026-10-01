import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { LocalStorageService } from "../../common/storage/local-storage.service";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";
@Module({
  imports: [CommonModule],
  controllers: [UsersController],
  providers: [UsersService, LocalStorageService],
  exports: [UsersService],
})
export class UsersModule {}
