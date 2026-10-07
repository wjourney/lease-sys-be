import "dotenv/config";
import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "../app.module";
import { PrismaService } from "../database/prisma.service";
import { RentBillingService } from "../modules/incomes/rent-billing.service";
import { planUnitTypes } from "../modules/projects/unit-type-migration";
import { insert, lock, update } from "../common/database/record-mutations";
import { plusMonths } from "../common/utils/rent-period";
import { serial } from "../common/utils/value";
process.env.DISABLE_SCHEDULER = "true";
async function main() {
  const apply = process.argv.includes("--apply");
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ["error"] });
  try {
    const db = app.get(PrismaService), billing = app.get(RentBillingService);
    const actor = await db.user.findFirstOrThrow({ where: { role: "SUPER_ADMIN", status: "ACTIVE", deletedAt: null } });
    const projects = await db.project.findMany({ where: { deletedAt: null } });
    for (const project of projects) {
      await db.$transaction(async tx => {
        await lock(tx, "projects", project.id);
        const fresh = await tx.project.findUniqueOrThrow({ where: { id: project.id } });
        const units = await tx.unit.findMany({ where: { projectId: project.id } });
        const plan = planUnitTypes(fresh, units);
        console.log(JSON.stringify({ projectId: project.id, types: plan.types.length, remappedUnits: plan.assignments.length, incomplete: plan.incomplete, apply }));
        if (!apply || !plan.assignments.length) return;
        await update(tx, "projects", fresh, { typeConfigs: JSON.parse(JSON.stringify(plan.types)) }, actor, "按现有单位属性拆分历史单位类型");
        for (const item of plan.assignments) {
          const unit = units.find(u => u.id === item.id)!;
          await update(tx, "units", unit, { unitTypeCode: item.code }, actor, "关联历史单位类型，保留原有属性和价格");
        }
      }, { timeout: 30000 });
    }
    const orders = await db.order.findMany({ where: { deletedAt: null, status: { in: ["PENDING", "ACTIVE"] } } });
    for (const order of orders) await db.$transaction(async tx => {
      await lock(tx, "orders", order.id);
      const fresh = await tx.order.findUniqueOrThrow({ where: { id: order.id } });
      if (fresh.deletedAt || !["PENDING", "ACTIVE"].includes(fresh.status)) return;
      const commissions = await tx.commission.findMany({ where: { orderId: order.id }, orderBy: { periodStart: "asc" } });
      console.log(JSON.stringify({ orderId: order.id, billingVersion: fresh.billingVersion, backfill: true, apply }));
      if (!apply) return;
      await billing.fullTerm(tx, fresh, actor, true);
      const first = commissions.find(c => !c.deletedAt && c.status !== "VOID");
      if (first?.mode === "RECURRING_MONTHLY" && first.amount && first.dueOn) {
        for (let index = 0; index < 600; index++) {
          const start = plusMonths(fresh.startsOn, index);
          if (start > fresh.endsOn) break;
          if (commissions.some(c => c.periodStart.getTime() === start.getTime())) continue;
          await insert(tx, "commissions", { orderId: order.id, salesCompanyId: fresh.salesCompanyId, salesUserId: fresh.salesUserId, commissionNo: serial("CM"), mode: first.mode, amount: first.amount, remark: first.remark, periodStart: start, periodEnd: new Date(Math.min(plusMonths(fresh.startsOn, index + 1).getTime() - 86400000, fresh.endsOn.getTime())), dueOn: plusMonths(first.dueOn, index), status: "OPEN" }, actor);
        }
      }
      await update(tx, "orders", fresh, { nextBillOn: null, occupancyState: "OCCUPIED" }, actor, "补齐租期账单和月结佣金，保留历史金额和结算记录");
    }, { timeout: 30000 });
  } finally { await app.close(); }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
