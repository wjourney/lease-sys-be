import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { financial } from "../../common/auth/actor";
import { ConflictException } from "@nestjs/common";
import { z } from "zod";
import { demand } from "../../common/utils/errors";
import { insert, lock, update } from "../../common/database/record-mutations";
import { number, plain, serial } from "../../common/utils/value";
import { InvoiceDraftInput, InvoiceQuery } from "./invoice-query";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
@Injectable()
export class InvoicesService extends ResourceService {
  readonly resource = "invoices";
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
  ) {
    super(db, access);
  }
  async list(a: Actor, input: any = {}) {
    this.access.allow(a, "invoices");
    const q = InvoiceQuery.parse(input);
    const and: any[] = [
      { deletedAt: null },
      await this.access.scope(a, "invoices"),
    ];
    if (q.status && q.status !== "ALL") and.push({ status: q.status });
    if (q.emailStatus) and.push({ emailStatus: q.emailStatus });
    if (q.incomeId) and.push({ incomeId: q.incomeId });
    if (q.billId) {
      const bill = await this.access.get(a, "incomes", q.billId);
      if (bill.recordType !== "RECEIVABLE") fail("请选择应收账单");
      const receipts = await this.db.income.findMany({
        where: { parentId: bill.id, deletedAt: null },
        select: { id: true },
      });
      and.push({ incomeId: { in: [bill.id, ...receipts.map((r) => r.id)] } });
    }
    if (q.from || q.to)
      and.push({
        issuedOn: {
          ...(q.from ? { gte: q.from } : {}),
          ...(q.to ? { lte: q.to } : {}),
        },
      });
    if (q.q) {
      const [orders, units] = await Promise.all([
        this.db.order.findMany({
          where: {
            deletedAt: null,
            OR: [
              { orderNo: { contains: q.q } },
              { tenantName: { contains: q.q } },
              { tenantPhone: { contains: q.q } },
            ],
          },
          select: { id: true },
        }),
        this.db.unit.findMany({
          where: { deletedAt: null, unitNo: { contains: q.q } },
          select: { id: true },
        }),
      ]);
      const incomes = await this.db.income.findMany({
        where: {
          deletedAt: null,
          OR: [
            { payerName: { contains: q.q } },
            { recordNo: { contains: q.q } },
            { orderId: { in: orders.map((o) => o.id) } },
            { unitId: { in: units.map((u) => u.id) } },
          ],
        },
        select: { id: true },
      });
      and.push({
        OR: [
          { invoiceNo: { contains: q.q } },
          { incomeId: { in: incomes.map((i) => i.id) } },
          { snapshot: { path: "$.payerName", string_contains: q.q } },
        ],
      });
    }
    const where = { AND: and };
    const [rows, total] = await Promise.all([
      this.db.invoice.findMany({
        where,
        orderBy: [{ [q.sortBy]: q.sort }, { id: "asc" }],
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
      }),
      this.db.invoice.count({ where }),
    ]);
    return {
      items: await this.enrichMany(a, rows),
      total,
      page: q.page,
      pageSize: q.pageSize,
    };
  }
  protected async enrichMany(a: Actor, rows: any[]) {
    if (!rows.length) return [];
    const incomes = await this.db.income.findMany({
      where: { id: { in: rows.map((r) => r.incomeId) } },
    });
    const parents = await this.db.income.findMany({
      where: {
        id: {
          in: incomes.map((r) => r.parentId).filter((id): id is string => !!id),
        },
      },
    });
    const byIncome = new Map([...incomes, ...parents].map((r) => [r.id, r]));
    const bills = incomes
      .map((r) =>
        r.recordType === "RECEIVABLE" ? r : byIncome.get(r.parentId!),
      )
      .filter(Boolean);
    const orders = await this.db.order.findMany({
      where: {
        id: {
          in: bills.map((r) => r!.orderId).filter((id): id is string => !!id),
        },
      },
    });
    const [projects, units] = await Promise.all([
      this.db.project.findMany({
        where: {
          id: {
            in: orders
              .map((o) => o.projectId)
              .filter((id): id is string => !!id),
          },
        },
      }),
      this.db.unit.findMany({
        where: {
          id: {
            in: orders.map((o) => o.unitId).filter((id): id is string => !!id),
          },
        },
      }),
    ]);
    return Promise.all(
      rows.map(async (r) => {
        const income = byIncome.get(r.incomeId);
        const bill =
          income?.recordType === "RECEIVABLE"
            ? income
            : byIncome.get(income?.parentId ?? "");
        const order = orders.find((o) => o.id === bill?.orderId);
        const s = r.snapshot || {};
        return {
          ...(await this.access.output(a, "invoices", r)),
          billId: bill?.id,
          billNo: bill?.recordNo || s.billNo,
          orderId: order?.id || s.orderId,
          orderNo: s.orderNo || order?.orderNo,
          projectName:
            s.projectName ||
            projects.find((p) => p.id === order?.projectId)?.name,
          unitNo: s.unitNo || units.find((u) => u.id === order?.unitId)?.unitNo,
          payerName: s.payerName || income?.payerName || bill?.payerName,
          payerPhone: s.payerPhone || order?.tenantPhone,
          dueOn: s.dueOn || bill?.dueOn,
          feeType: s.feeType || bill?.feeType,
          periodStart: s.periodStart || bill?.periodStart,
          periodEnd: s.periodEnd || bill?.periodEnd,
        };
      }),
    );
  }
  async enrich(a: Actor, row: any) {
    return (await this.enrichMany(a, [row]))[0];
  }
  private async lockedBill(a: Actor, billId: string, tx: any) {
    const initial = await this.access.get(a, "incomes", billId, tx);
    if (initial.orderId) await lock(tx, "orders", initial.orderId);
    await lock(tx, "incomes", billId);
    const bill = await this.access.get(a, "incomes", billId, tx);
    if (bill.recordType !== "RECEIVABLE" || bill.status === "VOID")
      fail("请选择有效应收账单");
    return bill;
  }
  private async checkExisting(tx: any, billId: string, excludeId?: string) {
    const receipts = await tx.income.findMany({
      where: { parentId: billId, deletedAt: null },
      select: { id: true },
    });
    const existing = await tx.invoice.findFirst({
      where: {
        incomeId: { in: [billId, ...receipts.map((r: any) => r.id)] },
        status: { in: ["DRAFT", "ACTIVE"] },
        deletedAt: null,
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
    if (existing)
      fail("账单已有草稿或已出具发票，请查看现有发票或先作废后重新开具");
  }
  private async draftValues(a: Actor, bill: any, input: any, tx: any) {
    const order = bill.orderId
      ? await tx.order.findUnique({ where: { id: bill.orderId } })
      : null;
    if (order?.deletedAt || ["DRAFT", "CLOSED"].includes(order?.status))
      fail("当前订单不能开具发票");
    const amount = number(bill.amount).add(bill.adjustmentAmount ?? 0);
    if (!amount.gt(0)) fail("账单金额须大于零");
    const [project, unit] = await Promise.all([
      order?.projectId
        ? tx.project.findUnique({ where: { id: order.projectId } })
        : null,
      order?.unitId
        ? tx.unit.findUnique({ where: { id: order.unitId } })
        : null,
    ]);
    return {
      amount,
      currency: bill.currency,
      issuedOn: input.issuedOn,
      snapshot: plain({
        billId: bill.id,
        billNo: bill.recordNo,
        recordNo: bill.recordNo,
        orderId: order?.id,
        orderNo: order?.orderNo,
        projectName: project?.name,
        unitNo: unit?.unitNo,
        payerName: bill.payerName || order?.tenantName,
        payerPhone: order?.tenantPhone,
        payerEmail: bill.payerEmail || order?.tenantEmail,
        feeType: bill.feeType,
        dueOn: input.dueOn,
        periodStart: bill.periodStart,
        periodEnd: bill.periodEnd,
        amount: amount.toFixed(2),
        remark: input.remark || "",
        documentType: "BILL",
      }),
    };
  }
  async create(a: Actor, body: any) {
    demand(financial(a));
    const d = InvoiceDraftInput.parse(body);
    return this.db.$transaction(
      async (tx) => {
        const bill = await this.lockedBill(a, d.billId, tx);
        await this.checkExisting(tx, bill.id);
        return insert(
          tx,
          "invoices",
          {
            invoiceNo: serial("INV"),
            incomeId: bill.id,
            status: "DRAFT",
            ...(await this.draftValues(a, bill, d, tx)),
          },
          a,
        );
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
  async edit(a: Actor, key: string, body: any) {
    demand(financial(a));
    const { revision, ...rest } = z
      .object({
        revision: z.number().int().positive(),
        issuedOn: z.string(),
        dueOn: z.string(),
        remark: z.string().max(3000).optional(),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(
      async (tx) => {
        const initial = await this.access.get(a, "invoices", key, tx);
        const bill = await this.lockedBill(a, initial.incomeId, tx);
        await lock(tx, "invoices", key);
        const old = await this.access.get(a, "invoices", key, tx);
        if (old.status !== "DRAFT") fail("只能编辑草稿发票");
        if (old.revision !== revision)
          throw new ConflictException("记录已更新，请刷新");
        const d = InvoiceDraftInput.parse({ ...rest, billId: bill.id });
        return update(
          tx,
          "invoices",
          old,
          await this.draftValues(a, bill, d, tx),
          a,
          "编辑发票草稿",
        );
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
  async issue(a: Actor, key: string) {
    demand(financial(a));
    return this.db.$transaction(
      async (tx) => {
        const initial = await this.access.get(a, "invoices", key, tx);
        if (initial.status === "ACTIVE") return initial;
        const bill = await this.lockedBill(a, initial.incomeId, tx);
        await lock(tx, "invoices", key);
        const old = await this.access.get(a, "invoices", key, tx);
        if (old.status === "ACTIVE") return old;
        if (old.status !== "DRAFT") fail("只能出具草稿发票");
        await this.checkExisting(tx, bill.id, key);
        const snapshot = old.snapshot as any;
        const d = InvoiceDraftInput.parse({
          billId: bill.id,
          issuedOn: old.issuedOn.toISOString().slice(0, 10),
          dueOn: String(snapshot.dueOn).slice(0, 10),
          remark: snapshot.remark,
        });
        return update(
          tx,
          "invoices",
          old,
          { ...(await this.draftValues(a, bill, d, tx)), status: "ACTIVE" },
          a,
          "出具发票",
        );
      },
      { isolationLevel: "ReadCommitted" },
    );
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    fail("该业务请使用关闭、作废或停用操作");
  }
}
