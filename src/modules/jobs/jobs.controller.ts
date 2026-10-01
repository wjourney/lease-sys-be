import { Controller, Inject, Post, Req } from "@nestjs/common";
import { financial } from "../../common/auth/actor";
import { demand } from "../../common/utils/errors";
import { JobsService } from "./jobs.service";
@Controller("jobs")
export class JobsController {
  constructor(@Inject(JobsService) private service: JobsService) {}
  @Post("run") run(@Req() r: any) {
    demand(financial(r.actor));
    return this.service.generateDue(r.actor);
  }
}
