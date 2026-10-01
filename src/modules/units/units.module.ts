import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { UnitsController } from "./units.controller";
import { UnitsService } from "./units.service";
@Module({
  imports: [CommonModule],
  controllers: [UnitsController],
  providers: [UnitsService],
  exports: [UnitsService],
})
export class UnitsModule {}
