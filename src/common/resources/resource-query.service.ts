import { z } from "zod";
import { PrismaService } from "../../database/prisma.service";
import { AccessService } from "../auth/access.service";
import { Actor, internal } from "../auth/actor";
import { fail } from "../utils/errors";
import { csvExport } from "./csv";
import { delegate, ownerMap } from "./resource-map";
export abstract class ResourceQueryService {
  abstract readonly resource: string;
  constructor(
    readonly db: PrismaService,
    readonly access: AccessService,
  ) {}
  protected async listConditions(_a: Actor, _q: any): Promise<any[]> { return []; }
  async export(a: Actor, q: Record<string, unknown>) {
    const rows: Record<string, unknown>[] = [];
    let page = 1;
    while (rows.length < 5000) {
      const result = await this.list(a, { ...q, page, pageSize: 100 });
      rows.push(...result.items);
      if (rows.length >= result.total) break;
      page++;
    }
    return csvExport(rows);
  }
  async list(a: Actor, q: any = {}) {
    const r = this.resource;

    this.access.allow(a, r);
    const page = Math.max(1, Number(q.page) || 1),
      pageSize = Math.min(100, Math.max(1, Number(q.pageSize) || 12));
    if (
      r === "units" &&
      !internal(a) &&
      (q.rentMin !== undefined ||
        q.rentMax !== undefined ||
        q.sortBy === "referenceRent")
    ) {
      if (!z.string().uuid().safeParse(q.projectId).success)
        fail("无权按具体租金筛选");
      const project = await this.db.project.findUnique({
        where: { id: q.projectId },
        select: { salesCanViewExactRent: true },
      });
      if (!project?.salesCanViewExactRent) fail("无权按具体租金筛选");
    }
    const and: any[] = [{ deletedAt: null }, await this.access.scope(a, r), ...await this.listConditions(a, q)];
    const search: any = {
      users: ["name", "username", "phone"],
      "sales-companies": ["name", "nameEn", "registrationNo", "contactName", "phone"],
      projects: ["name", "address"],
      units: ["unitNo", "building"],
      orders: ["orderNo", "tenantName"],
      incomes: ["recordNo", "payerName"],
      expenses: ["expenseNo", "payeeName"],
      commissions: ["commissionNo"],
      invoices: ["invoiceNo"],
      materials: ["title"],
      "fund-accounts": ["name"],
      settings: ["key"],
    };
    if (q.q)
      and.push({
        OR: search[r].map((k) => ({
          [k]: { contains: String(q.q).slice(0, 100) },
        })),
      });
    if (
      q.status &&
      [
        "users",
        "projects",
        "orders",
        "incomes",
        "expenses",
        "invoices",
        "materials",
      ].includes(r)
    )
      and.push({ status: q.status });
    if (
      r === "units" &&
      ["AVAILABLE", "LOCKED", "OCCUPIED"].includes(q.status)
    ) {
      const occupied = await this.db.order.findMany({
        where: {
          deletedAt: null,
          status: { not: "CLOSED" },
          occupancyState:
            { not: "RELEASED" },
        },
        select: { unitId: true },
      });
      and.push({
        id: {
          [q.status === "AVAILABLE" ? "notIn" : "in"]: occupied.map(
            (x) => x.unitId,
          ),
        },
      });
    }
    if (r === "incomes")
      and.push({ recordType: q.parentId || q.recordType === "RECEIPT" ? "RECEIPT" : "RECEIVABLE" });
    if (r === "materials" && q.current !== "false")
      and.push({ isCurrent: true });
    const filters: any = {
      units: ["projectId", "unitTypeCode"],
      orders: ["projectId", "unitId", "salesCompanyId", "salesUserId"],
      incomes: ["parentId", "orderId", "projectId", "feeType"],
      expenses: ["orderId", "commissionId", "feeType"],
      commissions: ["orderId", "salesCompanyId", "salesUserId", "mode"],
      invoices: ["incomeId"],
      materials: [...Object.keys(ownerMap), "category", "materialGroupId"],
      users: ["salesCompanyId", "role"],
      settings: ["key"],
    };
    for (const k of filters[r] ?? [])
      if (q[k]) {
        if (k.endsWith("Id") && !z.string().uuid().safeParse(q[k]).success)
          fail("无效关联 ID");
        and.push({ [k]: q[k] });
      }
    if (r === "units") {
      const rentMin = q.rentMin === undefined ? undefined : Number(q.rentMin);
      const rentMax = q.rentMax === undefined ? undefined : Number(q.rentMax);
      if (
        [rentMin, rentMax].some(
          (value) =>
            value !== undefined && (!Number.isFinite(value) || value < 0),
        ) ||
        (rentMin !== undefined && rentMax !== undefined && rentMin > rentMax)
      )
        fail("租金范围无效");
      if (rentMin !== undefined || rentMax !== undefined)
        and.push({
          referenceRent: {
            ...(rentMin !== undefined ? { gte: rentMin } : {}),
            ...(rentMax !== undefined ? { lte: rentMax } : {}),
          },
        });
    }
    if (
      (q.from && !/^\d{4}-\d{2}-\d{2}$/.test(q.from)) ||
      (q.to && !/^\d{4}-\d{2}-\d{2}$/.test(q.to))
    )
      fail("日期筛选格式无效");
    if (
      q.from &&
      q.to &&
      ["commissions", "incomes", "expenses", "invoices"].includes(r)
    ) {
      const field =
        r === "commissions"
          ? "periodStart"
          : r === "invoices"
            ? "issuedOn"
            : "dueOn";
      and.push({ [field]: { gte: new Date(q.from), lte: new Date(q.to) } });
    }
    const sort = q.sort === "asc" ? "asc" : "desc";
    const sortField =
      r === "units" && q.sortBy === "referenceRent"
        ? "referenceRent"
        : ["createdAt", "updatedAt"].includes(q.sortBy)
          ? q.sortBy
          : "createdAt";
    const [items, total] = await Promise.all([
      (this.db as any)[delegate[r]].findMany({
        where: { AND: and },
        orderBy: {
          [sortField]: ["createdAt", "referenceRent"].includes(sortField)
            ? sort
            : "desc",
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      (this.db as any)[delegate[r]].count({ where: { AND: and } }),
    ]);
    return {
      items: await Promise.all(items.map((x) => this.enrich(a, x))),
      total,
      page,
      pageSize,
    };
  }
  async enrich(a: Actor, row: any) {
    const r = this.resource;
    const x = await this.access.output(a, r, row);
    if (row.projectId) {
      const p = await this.db.project.findUnique({
        where: { id: row.projectId },
        select: { name: true },
      });
      x.projectName = p?.name;
    }
    if (row.unitId) {
      const u = await this.db.unit.findUnique({
        where: { id: row.unitId },
        select: { unitNo: true },
      });
      x.unitNo = u?.unitNo;
    }
    if (row.salesCompanyId) {
      const c = await this.db.salesCompany.findUnique({
        where: { id: row.salesCompanyId },
        select: {
          name: true,
          ...(r === "users" ? { companyNo: true, serviceEndsOn: true } : {}),
        },
      });
      x.companyName = c?.name;
      if (r === "users") {
        x.companyNo = c?.companyNo;
        x.companyServiceEndsOn = c?.serviceEndsOn;
      }
    }
    if (row.salesUserId) {
      const u = await this.db.user.findUnique({
        where: { id: row.salesUserId },
        select: { name: true },
      });
      x.salesName = u?.name;
    }
    if (row.orderId) {
      const o = await this.db.order.findUnique({
        where: { id: row.orderId },
        select: { orderNo: true },
      });
      x.orderNo = o?.orderNo;
    }
    return x;
  }
  async detail(a: Actor, key: string) {
    const row = await this.access.get(a, this.resource, key);
    return {
      ...(await this.enrich(a, row)),
      operations: this.visibleOperations(a, row),
    };
  }
  async operations(a: Actor, key: string) {
    const row = await this.access.get(a, this.resource, key);
    return this.visibleOperations(a, row);
  }
  protected visibleOperations(a: Actor, row: any) {
    const r = this.resource;
    if (
      !internal(a) &&
      ["projects", "units", "settings", "fund-accounts", "materials"].includes(
        r,
      )
    )
      return [];
    const logs = row.operationLogs as any[];
    if (!internal(a) && r === "orders")
      return logs.map((entry) => ({
        ...entry,
        changes: Object.fromEntries(
          Object.entries(entry.changes ?? {}).filter(
            ([key]) => !["unitSnapshot", "salesSnapshot"].includes(key),
          ),
        ),
      }));
    return logs;
  }
}
