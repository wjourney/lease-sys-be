import { Module } from "@nestjs/common";
import { DatabaseModule } from "../database/database.module";
import { AccessService } from "./auth/access.service";
@Module({
  imports: [DatabaseModule],
  providers: [AccessService],
  exports: [DatabaseModule, AccessService],
})
export class CommonModule {}
