import { Controller, Get, Inject } from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { Public } from "../auth/public.decorator";
@Controller("health")
export class HealthController {
  constructor(@Inject(PrismaService) private db: PrismaService) {}
  @Public() @Get() async health() {
    await this.db.$queryRaw`SELECT 1`;
    return { status: "ok" };
  }
}
