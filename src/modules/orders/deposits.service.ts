import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { Actor, financial } from "../../common/auth/actor";
import { demand } from "../../common/utils/errors";
import { number, plain } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { depositSummary } from "./deposit-summary";

const Query = z
  .object({
    q: z.string().trim().max(100).optional(),
    projectId: z.string().uuid().optional(),
    state: z
      .enum([
        "UNCOLLECTED",
        "HELD",
        "REFUND_PENDING",
        "SETTLED",
        "NOT_REQUIRED",
      ])
      .optional(),
    page: z.coerce.number().int().min(1).max(1000000).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(12),
  })
  .strict();

@Injectable()
export class DepositsService {
  constructor(@Inject(PrismaService) readonly db: PrismaService) {}
  async list(actor: Actor, input: unknown) {
    demand(financial(actor));
    const q = Query.parse(input);
    // Deposit states are derived from actual money records, never separately stored.
    // Batch reads in a consistent snapshot avoid one detail request per order.
    return this.db.$transaction(
      async (tx) => {
        const orders = await tx.order.findMany({
          where: {
            deletedAt: null,
            status: { not: "DRAFT" },
            ...(q.projectId ? { projectId: q.projectId } : {}),
          },
          select: {
            id: true,
            orderNo: true,
            tenantName: true,
            tenantPhone: true,
            projectId: true,
            unitId: true,
            unitSnapshot: true,
            endsOn: true,
            actualTerminationOn: true,
            status: true,
            currency: true,
            depositAmount: true,
            depositSettledAt: true,
            depositDeductionAmount: true,
          },
        });
        const ids = orders.map((o) => o.id);
        const [roots, refunds, projects, units] = await Promise.all([
          tx.income.findMany({
            where: {
              orderId: { in: ids },
              deletedAt: null,
              recordType: "RECEIVABLE",
              feeType: "DEPOSIT",
              status: { not: "VOID" },
            },
            select: { id: true, orderId: true },
          }),
          tx.expense.findMany({
            where: {
              orderId: { in: ids },
              deletedAt: null,
              feeType: "DEPOSIT_REFUND",
              status: { not: "VOID" },
            },
            select: {
              id: true,
              orderId: true,
              amount: true,
              paidAmount: true,
              status: true,
              paymentRecords: true,
            },
          }),
          tx.project.findMany({
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
          tx.unit.findMany({
            where: {
              id: { in: orders.flatMap((o) => (o.unitId ? [o.unitId] : [])) },
            },
            select: { id: true, unitNo: true },
          }),
        ]);
        const receipts = await tx.income.findMany({
          where: {
            parentId: { in: roots.map((r) => r.id) },
            deletedAt: null,
            status: { in: ["CONFIRMED", "PENDING"] },
          },
          select: { parentId: true, status: true, amount: true },
        });
        const byRoot = new Map(roots.map((r) => [r.id, r.orderId]));
        const totals = new Map<string, { received: any; pending: any }>();
        for (const receipt of receipts) {
          const id = byRoot.get(receipt.parentId!);
          if (!id) continue;
          const total = totals.get(id) ?? {
            received: number(0),
            pending: number(0),
          };
          const field = receipt.status === "CONFIRMED" ? "received" : "pending";
          total[field] = total[field].add(receipt.amount);
          totals.set(id, total);
        }
        const byOrder = new Map<string, typeof refunds>();
        for (const refund of refunds) {
          const entries = byOrder.get(refund.orderId!) ?? [];
          entries.push(refund);
          byOrder.set(refund.orderId!, entries);
        }
        const projectNames = new Map(projects.map((p) => [p.id, p.name]));
        const unitNames = new Map(units.map((u) => [u.id, u.unitNo]));
        const priority: Record<string, number> = {
          REFUND_PENDING: 0,
          UNCOLLECTED: 1,
          HELD: 2,
          SETTLED: 3,
          NOT_REQUIRED: 4,
        };
        const keyword = q.q?.toLocaleLowerCase();
        const rows = orders
          .map((o) => {
            const total = totals.get(o.id);
            const { unitSnapshot, ...order } = plain(o);
            return {
              ...order,
              projectName:
                projectNames.get(o.projectId!) ||
                unitSnapshot?.projectName ||
                "—",
              unitNo: unitNames.get(o.unitId!) || unitSnapshot?.unitNo || "—",
              deposit: depositSummary(
                o,
                total?.received ?? 0,
                total?.pending ?? 0,
                byOrder.get(o.id) ?? [],
              ),
            };
          })
          .filter(
            (row) =>
              (!q.state || row.deposit.state === q.state) &&
              (!keyword ||
                [
                  row.orderNo,
                  row.tenantName,
                  row.tenantPhone,
                  row.projectName,
                  row.unitNo,
                ].some((v) =>
                  String(v ?? "")
                    .toLocaleLowerCase()
                    .includes(keyword),
                )),
          )
          .sort(
            (a, b) =>
              priority[a.deposit.state] - priority[b.deposit.state] ||
              String(a.actualTerminationOn ?? a.endsOn).localeCompare(
                String(b.actualTerminationOn ?? b.endsOn),
              ) ||
              a.id.localeCompare(b.id),
          );
        return {
          items: rows.slice((q.page - 1) * q.pageSize, q.page * q.pageSize),
          total: rows.length,
          page: q.page,
          pageSize: q.pageSize,
          projects,
        };
      },
      { isolationLevel: "RepeatableRead", timeout: 15000 },
    );
  }
}
