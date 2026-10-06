import { orderSettlement } from "./order-settlement";
import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { capabilities } from "../../common/auth/permissions";
import { StorageService } from "../../common/storage/storage.service";
import { number, plain } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { normalizeUploadName } from "../materials/file-name";

@Injectable()
export class OrderDetailService {
  constructor(
    @Inject(PrismaService) readonly db: PrismaService,
    @Inject(AccessService) readonly access: AccessService,
    @Inject(StorageService) readonly storage: StorageService,
  ) {}
  async related(a: Actor, order: any) {
    const rights = capabilities(a);
    // Authorize the order before using its child IDs; never accept child IDs from the client.
    const roots = await this.db.income.findMany({
      where: { orderId: order.id, recordType: "RECEIVABLE", deletedAt: null },
      orderBy: { dueOn: "asc" },
    });
    const [receipts, expenses, commissions] = await Promise.all([
      this.db.income.findMany({
        where: { parentId: { in: roots.map((x) => x.id) }, deletedAt: null },
        orderBy: { createdAt: "desc" },
      }),
      this.db.expense.findMany({
        where: { orderId: order.id, deletedAt: null },
        orderBy: { createdAt: "desc" },
      }),
      this.db.commission.findMany({
        where: { orderId: order.id, deletedAt: null },
        orderBy: { createdAt: "asc" },
      }),
    ]);
    const sum = (rows: any[], key: string) =>
      rows.reduce((n, x) => n.add(x[key] ?? 0), number(0));
    const bills = roots.map((root) => {
      const children = receipts.filter((x) => x.parentId === root.id);
      const confirmed = sum(
          children.filter((x) => x.status === "CONFIRMED"),
          "amount",
        ),
        pending = sum(
          children.filter((x) => x.status === "PENDING"),
          "amount",
        );
      const total = number(root.amount).add(root.adjustmentAmount),
        offset = number(root.depositOffsetAmount);
      return {
        ...plain(root),
        operationLogs: undefined,
        receipts: children.map(({ operationLogs, ...r }) => ({
          ...plain(r),
          voucherIncomeId: (r.recurrenceRule as any)?.voucherIncomeId || r.id,
        })),
        total: total.toFixed(2),
        confirmed: confirmed.toFixed(2),
        pending: pending.toFixed(2),
        offset: offset.toFixed(2),
        remaining: total.sub(confirmed).sub(offset).toFixed(2),
        available: total.sub(confirmed).sub(offset).sub(pending).toFixed(2),
      };
    });
    const deposits = bills.filter(
      (x) => x.feeType === "DEPOSIT" && x.status !== "VOID",
    );
    const received = sum(deposits, "confirmed"),
      pending = sum(deposits, "pending");
    const refunds = expenses.filter(
      (x) => x.feeType === "DEPOSIT_REFUND" && x.status !== "VOID",
    );
    const refunded = sum(refunds, "paidAmount"),
      refundDue = sum(refunds, "amount").sub(refunded);
    const deduction = number(order.depositDeductionAmount);
    const depositState =
      order.status === "CLOSED"
        ? "CLOSED"
        : order.depositSettledAt
          ? refundDue.gt(0)
            ? "REFUND_PENDING"
            : "SETTLED"
          : order.handoverStatus === "DONE"
            ? "SETTLEMENT_PENDING"
            : received.lt(order.depositAmount)
              ? "COLLECTING"
              : "HELD";
    const first = bills.filter(
      (x) =>
        x.status !== "VOID" &&
        (x.feeType === "DEPOSIT" ||
          x.sourceKey ===
            `rent:${order.id}:${order.startsOn.toISOString().slice(0, 10)}`),
    );
    const firstRemaining = sum(first, "remaining"),
      firstPending = sum(first, "pending"),
      firstConfirmed = sum(first, "confirmed");
    const firstState = firstRemaining.lte(0)
      ? "PAID"
      : firstPending.gt(0)
        ? "PENDING"
        : firstConfirmed.gt(0)
          ? "PARTIAL"
          : "UNPAID";
    const hasPayments =
      order.occupancyState === "OCCUPIED" ||
      receipts.some((x) => ["PENDING", "CONFIRMED"].includes(x.status));
    const materials = rights.read.includes("materials")
      ? await this.db.material.findMany({
          where: {
            AND: [
              {
                deletedAt: null,
                isCurrent: true,
                OR: [
                  { orderId: order.id },
                  {
                    incomeId: { in: [...roots, ...receipts].map((x) => x.id) },
                  },
                  ...(rights.read.includes("expenses")
                    ? [{ expenseId: { in: expenses.map((x) => x.id) } }]
                    : []),
                ],
              },
              await this.access.scope(a, "materials"),
            ],
          },
          orderBy: { createdAt: "desc" },
        })
      : [];
    return {
      bills: rights.read.includes("incomes") ? bills : [],
      rentRefunds: rights.read.includes("expenses")
        ? expenses
            .filter((x) => x.feeType === "RENT_REFUND" && x.status !== "VOID")
            .map(({ operationLogs, ...r }) => plain(r))
        : [],
      orderCommission: rights.write.includes("orders")
        ? (() => {
            const c = commissions.find((item) => item.status !== "VOID");
            return c
              ? plain({
                  id: c.id,
                  mode: c.mode,
                  periodStart: c.periodStart,
                  periodEnd: c.periodEnd,
                  dueOn: c.dueOn,
                  amount: c.amount,
                  remark: c.remark,
                })
              : null;
          })()
        : null,
      commissions: await Promise.all(
        (rights.read.includes("commissions") || rights.manageOrders
          ? commissions
          : []
        ).map(async (c) => {
          const related = await this.db.expense.findMany({
            where: {
              commissionId: c.id,
              deletedAt: null,
              status: { not: "VOID" },
            },
          });
          const paid = sum(related, "paidAmount"),
            committed = sum(related, "amount");
          const [company, sales] = await Promise.all([
            this.db.salesCompany.findUnique({
              where: { id: c.salesCompanyId },
            }),
            c.salesUserId
              ? this.db.user.findUnique({ where: { id: c.salesUserId } })
              : null,
          ]);
          return {
            ...(await this.access.output(a, "commissions", c)),
            companyName: company?.name,
            salesName: sales?.name,
            paidAmount: paid.toFixed(2),
            status:
              c.status === "VOID"
                ? "VOID"
                : c.amount == null
                  ? "UNSET"
                  : paid.eq(c.amount)
                    ? "PAID"
                    : paid.gt(0)
                      ? "PARTIAL"
                      : "OPEN",
            remainingAmount:
              c.amount == null ? null : number(c.amount).sub(paid).toFixed(2),
            availableAmount:
              c.amount == null
                ? null
                : number(c.amount).sub(committed).toFixed(2),
          };
        }),
      ),
      deposit: {
        state: depositState,
        agreed: order.depositAmount,
        received: received.toFixed(2),
        pending: pending.toFixed(2),
        deduction: deduction.toFixed(2),
        refunded: refunded.toFixed(2),
        refundDue: refundDue.toFixed(2),
        held: received.sub(deduction).sub(refunded).toFixed(2),
        refunds: rights.read.includes("expenses")
          ? refunds.map(({ operationLogs, ...r }) => plain(r))
          : [],
      },
      firstPaymentStatus: firstState,
      settlement: orderSettlement(
        order,
        roots,
        receipts,
        expenses,
        commissions,
      ),
      actions: {
        edit: rights.write.includes("orders") && order.status !== "CLOSED",
        editLease:
          rights.write.includes("orders") &&
          order.status === "PENDING" &&
          !hasPayments,
        close:
          rights.write.includes("orders") &&
          order.status === "PENDING" &&
          !hasPayments,
        moveIn:
          rights.manageOrders &&
          order.status === "ACTIVE" &&
          order.occupancyState === "LOCKED",
        terminate: rights.manageOrders && order.status === "ACTIVE",
        handover:
          rights.manageOrders &&
          order.status === "COMPLETED" &&
          order.handoverStatus !== "DONE",
        settle:
          rights.finance &&
          order.status === "COMPLETED" &&
          order.handoverStatus === "DONE" &&
          !order.depositSettledAt &&
          pending.eq(0),
        refund: rights.finance && refundDue.gt(0),
      },
      materials: await Promise.all(
        materials.map(async (m) => ({
          ...(await this.access.output(a, "materials", m)),
          originalName: m.originalName
            ? normalizeUploadName(m.originalName)
            : null,
          downloadUrl: m.storageKey
            ? `/api/v1/materials/${m.id}/download`
            : null,
          previewUrl: m.storageKey
            ? await this.storage.previewUrl(
                {
                  storageKey: m.storageKey,
                  storageProvider: m.storageProvider,
                },
                `/api/v1/materials/${m.id}/download`,
              )
            : null,
        })),
      ),
      relatedOperations: [
        ...roots,
        ...receipts,
        ...(rights.read.includes("expenses") ? expenses : []),
        ...(rights.read.includes("commissions") || rights.manageOrders
          ? commissions
          : []),
      ].flatMap((r: any) =>
        (r.operationLogs ?? []).map((log: any) => ({
          ...log,
          subject: r.recordNo || r.expenseNo || r.commissionNo,
        })),
      ),
    };
  }
}
