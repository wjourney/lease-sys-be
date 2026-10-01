import { Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";
import { CommonModule } from "../../common/common.module";
import { AuthController } from "./auth.controller";
import { AuthGuard } from "./auth.guard";
import { AuthService } from "./auth.service";
@Module({
  imports: [CommonModule],
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: AuthGuard }],
})
export class AuthModule {}
