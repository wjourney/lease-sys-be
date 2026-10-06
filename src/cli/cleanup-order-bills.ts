import "reflect-metadata";
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { PrismaService } from "../database/prisma.service";
import { lock, update } from "../common/database/record-mutations";
import { obsoleteOrderBill } from "../modules/orders/obsolete-order-bills";

async function referenced(tx: any, id: string) {
  // Even rejected/deleted references prevent automatic archival.
  return (
    (await tx.income.count({ where: { parentId: id } })) +
    (await tx.expense.count({ where: { originalIncomeId: id } })) +
    (await tx.invoice.count({ where: { incomeId: id } })) +
    (await tx.material.count({ where: { incomeId: id } }))
  );
}
async function main() {
  const apply = process.argv.includes("--apply");
  const value = (flag: string) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? process.argv[i + 1] : undefined;
  };
  const backup = value("--backup");
  const actorId = value("--actor-id");
  if (apply && (!backup || !actorId))
    throw new Error(
      "--apply requires --backup <new absolute file> and --actor-id <admin UUID>",
    );
  if (backup && !backup.startsWith("/"))
    throw new Error("Backup must use an absolute path");
  const db = new PrismaService();
  try {
    const actor = apply
      ? await db.user.findFirst({
          where: { id: actorId, role: "SUPER_ADMIN", deletedAt: null },
        })
      : null;
    if (apply && !actor) throw new Error("A valid administrator is required");
    const orders = await db.order.findMany({ where: { deletedAt: null } });
    const bills = await db.income.findMany({
      where: { recordType: "RECEIVABLE", deletedAt: null },
    });
    const candidates: NonNullable<ReturnType<typeof obsoleteOrderBill>>[] = [];
    for (const bill of bills) {
      const plan = obsoleteOrderBill(
        bill,
        orders.find((o) => o.id === bill.orderId),
        bills,
      );
      if (plan && !(await referenced(db, bill.id))) candidates.push(plan);
    }
    console.log(
      JSON.stringify(
        { mode: apply ? "apply" : "dry-run", candidates },
        null,
        2,
      ),
    );
    if (!apply || !candidates.length) return;
    // Exclusive, owner-only backup; never overwrite a previous backup.
    writeFileSync(
      backup!,
      JSON.stringify(
        {
          capturedAt: new Date().toISOString(),
          candidates,
          before: bills.filter((b) =>
            candidates.some((c) => c.id === b.id || c.replacementId === b.id),
          ),
          orders: orders.filter((o) =>
            candidates.some((c) => c.orderId === o.id),
          ),
        },
        null,
        2,
      ),
      { flag: "wx", mode: 0o600 },
    );
    const archived = await db.$transaction(
      async (tx) => {
        for (const key of [
          ...new Set(candidates.map((c) => c.orderId!)),
        ].sort())
          await lock(tx, "orders", key);
        for (const id of [
          ...new Set(candidates.flatMap((c) => [c.id, c.replacementId])),
        ].sort())
          await lock(tx, "incomes", id);
        for (const c of candidates) {
          const currentOrder = await tx.order.findUnique({
            where: { id: c.orderId },
          });
          const currentBills = await tx.income.findMany({
            where: {
              orderId: c.orderId,
              recordType: "RECEIVABLE",
              deletedAt: null,
            },
          });
          const old = currentBills.find((b) => b.id === c.id);
          const snapshot = bills.find((b) => b.id === c.id)!;
          const replacementSnapshot = bills.find(
            (b) => b.id === c.replacementId,
          )!;
          const replacement = currentBills.find(
            (b) => b.id === c.replacementId,
          );
          if (
            !old ||
            old.revision !== snapshot.revision ||
            replacement?.revision !== replacementSnapshot.revision ||
            currentOrder?.revision !==
              orders.find((o) => o.id === c.orderId)?.revision ||
            obsoleteOrderBill(old, currentOrder, currentBills)
              ?.replacementId !== c.replacementId ||
            (await referenced(tx, c.id))
          )
            throw new Error(
              `Data changed; no records archived. Retry dry-run: ${c.recordNo}`,
            );
          await update(
            tx,
            "incomes",
            old,
            { deletedAt: new Date(), deletedBy: actor!.id },
            {
              id: actor!.id,
              name: "历史重复账单清理",
              role: "SUPER_ADMIN",
              salesCompanyId: null,
              authVersion: 1,
            },
            `归档非计费修改误重建的重复账单；有效账单 ${c.replacementNo}；备份 ${backup}`,
          );
        }
        return candidates.length;
      },
      { timeout: 30000 },
    );
    console.log(JSON.stringify({ archived, backup, physicallyDeleted: 0 }));
  } finally {
    await db.$disconnect();
  }
}
main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
