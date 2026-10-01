import { Inject, Injectable, NotFoundException } from "@nestjs/common";
import { z } from "zod";
import { PrismaService } from "../../database/prisma.service";
import { delegate } from "../resources/resource-map";
import { demand, fail } from "../utils/errors";
import { plain } from "../utils/value";
import { Actor, internal } from "./actor";
import { readers, writers } from "./permissions";
@Injectable()
export class AccessService {
  constructor(@Inject(PrismaService) readonly db: PrismaService) {}
  allow(a: Actor, r: string, write = false) {
    demand((write ? writers : readers)[a.role]?.includes(r));
  }
  async scope(a: Actor, r: string, tx: any = this.db): Promise<any> {
    this.allow(a, r);
    if (internal(a)) return {};
    const company = a.salesCompanyId ?? "00000000-0000-0000-0000-000000000000";
    if (r === "users")
      return a.role === "SALES" ? { id: a.id } : { salesCompanyId: company };
    if (r === "sales-companies") return { id: company };
    if (r === "projects") return { status: "ACTIVE" };
    if (r === "units")
      return {
        enabled: true,
        projectId: {
          in: (
            await tx.project.findMany({
              where: { status: "ACTIVE", deletedAt: null },
              select: { id: true },
            })
          ).map((x) => x.id),
        },
      };
    if (r === "settings") return { key: "unit_types" };
    if (r === "fund-accounts") return { enabled: true };
    const orders = await tx.order.findMany({
      where: {
        deletedAt: null,
        salesCompanyId: company,
        ...(a.role === "SALES" ? { salesUserId: a.id } : {}),
      },
      select: { id: true },
    });
    const ids = orders.map((x) => x.id);
    if (r === "orders") return { id: { in: ids } };
    if (r === "commissions") return { orderId: { in: ids } };
    const roots = await tx.income.findMany({
      where: {
        orderId: { in: ids },
        recordType: "RECEIVABLE",
        deletedAt: null,
      },
      select: { id: true },
    });
    const rootIds = roots.map((x) => x.id);
    if (r === "incomes")
      return { OR: [{ id: { in: rootIds } }, { parentId: { in: rootIds } }] };
    const receipts = await tx.income.findMany({
      where: { parentId: { in: rootIds } },
      select: { id: true },
    });
    const receiptIds = receipts.map((x) => x.id);
    if (r === "invoices") return { incomeId: { in: receiptIds } };
    if (r === "materials") {
      const projects = await tx.project.findMany({
        where: { status: "ACTIVE", deletedAt: null },
        select: { id: true },
      });
      const pids = projects.map((x) => x.id);
      const units = await tx.unit.findMany({
        where: { projectId: { in: pids }, enabled: true, deletedAt: null },
        select: { id: true },
      });
      const inv = await tx.invoice.findMany({
        where: { incomeId: { in: receiptIds } },
        select: { id: true },
      });
      return {
        visibility: "SHARED",
        OR: [
          { projectId: { in: pids } },
          { unitId: { in: units.map((x) => x.id) } },
          { orderId: { in: ids } },
          { incomeId: { in: [...rootIds, ...receiptIds] } },
          { invoiceId: { in: inv.map((x) => x.id) } },
          { salesCompanyId: company },
          { userId: a.id },
        ],
      };
    }
    return { id: { in: [] } };
  }
  async get(a: Actor, r: string, key: string, tx: any = this.db) {
    if (!z.string().uuid().safeParse(key).success) fail("无效记录 ID");
    const row = await tx[delegate[r]].findFirst({
      where: {
        AND: [{ id: key, deletedAt: null }, await this.scope(a, r, tx)],
      },
    });
    if (!row) throw new NotFoundException("记录不存在或无访问权限");
    return row;
  }
  async output(a: Actor, r: string, row: any) {
    const x = plain(row);
    delete x.passwordHash;
    delete x.authVersion;
    delete x.operationLogs;
    if (r === "users") {
      x.avatarUrl = row.avatarStorageKey
        ? `/api/v1/users/${row.id}/avatar`
        : null;
      delete x.avatarStorageKey;
      delete x.avatarMimeType;
    }
    if (!internal(a) && r === "projects") {
      delete x.lessorProfile;
      delete x.extra;
    }
    if (!internal(a) && r === "orders") {
      delete x.unitSnapshot;
      delete x.salesSnapshot;
    }
    if (!internal(a) && r === "units") {
      const p = await this.db.project.findUnique({
        where: { id: row.projectId },
      });
      if (!p?.salesCanViewExactRent) delete x.referenceRent;
    }
    if (!internal(a) && r === "fund-accounts" && x.accountIdentifier)
      x.accountIdentifier = "****" + x.accountIdentifier.slice(-4);
    return x;
  }
}
