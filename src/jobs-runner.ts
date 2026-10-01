import { NestFactory } from "@nestjs/core";
import "dotenv/config";
import "reflect-metadata";
import { AppModule } from "./app.module";
import { PrismaService } from "./database/prisma.service";
import { JobsService } from "./modules/jobs/jobs.service";
process.env.DISABLE_SCHEDULER = "true";
async function main() {
  const app = await NestFactory.createApplicationContext(AppModule);
  try {
    const db = app.get(PrismaService);
    const user = await db.user.findFirstOrThrow({
      where: { role: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null },
    });
    console.log(
      await app.get(JobsService).generateDue({ ...user, name: "系统任务" }),
    );
  } finally {
    await app.close();
  }
}
void main();
