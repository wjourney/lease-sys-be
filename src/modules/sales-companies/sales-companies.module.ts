import { Module } from "@nestjs/common";
import { CommonModule } from "../../common/common.module";
import { SalesCompaniesController } from "./sales-companies.controller";
import { SalesCompaniesService } from "./sales-companies.service";
@Module({
  imports: [CommonModule],
  controllers: [SalesCompaniesController],
  providers: [SalesCompaniesService],
  exports: [SalesCompaniesService],
})
export class SalesCompaniesModule {}
