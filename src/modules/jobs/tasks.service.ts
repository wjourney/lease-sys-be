import {
  Inject,
  Injectable,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from "@nestjs/common";
import { PrismaService } from "../../database/prisma.service";
import { InvoiceEmailService } from "../invoices/invoice-email.service";
import { InvoiceRenderService } from "../invoices/invoice-render.service";
import { JobsService } from "./jobs.service";
@Injectable()
export class TasksService implements OnApplicationBootstrap, OnModuleDestroy {
  private running = false;
  private timer?: ReturnType<typeof setInterval>;
  constructor(
    @Inject(PrismaService) private db: PrismaService,
    @Inject(JobsService) private jobs: JobsService,
    @Inject(InvoiceRenderService) private renderer: InvoiceRenderService,
    @Inject(InvoiceEmailService) private email: InvoiceEmailService,
  ) {}
  onApplicationBootstrap() {
    if (process.env.DISABLE_SCHEDULER === "true") return;
    this.timer = setInterval(() => void this.tick(), 60000);
    this.timer.unref();
  }
  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }
  async tick() {
    if (this.running) return;
    this.running = true;
    try {
      const db = this.db;
      const actor = await db.user.findFirst({
        where: { role: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null },
      });
      if (!actor) return;
      const system = { ...actor, name: "系统任务", system: true };
      await this.jobs.generateDue(system);

      // A crashed renderer leaves a ten-minute lease; make it retryable after restart.
      await db.invoice.updateMany({
        where: {
          status: "ACTIVE",
          renderStatus: "PROCESSING",
          renderNextRetryAt: { lte: new Date() },
        },
        data: { renderStatus: "FAILED", renderError: "生成任务中断，等待重试" },
      });
      const pending = await db.invoice.findMany({
        where: {
          status: "ACTIVE",
          renderStatus: { in: ["PENDING", "FAILED"] },
          renderAttempts: { lt: 5 },
          OR: [
            { renderNextRetryAt: null },
            { renderNextRetryAt: { lte: new Date() } },
          ],
        },
        take: 5,
      });
      for (const inv of pending)
        try {
          await this.renderer.render(system, inv.id);
        } catch (e) {
          console.error(
            "PDF task failed",
            inv.id,
            e instanceof Error ? e.message : String(e),
          );
        }
      const emails = await db.invoice.findMany({
        where: {
          emailStatus: "PENDING",
          renderStatus: "READY",
          status: "ACTIVE",
        },
        take: 5,
      });
      for (const i of emails) await this.email.sendPending(system, i.id);
    } catch (e) {
      console.error("Background task failed", e);
    } finally {
      this.running = false;
    }
  }
}
