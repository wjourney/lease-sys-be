import { Controller, Get, Inject, Param, Query, Req } from "@nestjs/common";
import { CompanyCommissionsService } from "./company-commissions.service";
@Controller("company-commissions")
export class CompanyCommissionsController {
  constructor(
    @Inject(CompanyCommissionsService)
    private readonly service: CompanyCommissionsService,
  ) {}
  @Get() list(@Req() r: any, @Query() q: any) {
    return this.service.list(r.actor, q);
  }
  @Get(":id") detail(@Req() r: any, @Param("id") id: string) {
    return this.service.detail(r.actor, id);
  }
}
