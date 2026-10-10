import { resolveOperationActors } from "../../common/database/operation-actors";
import { lock } from "../../common/database/record-mutations";
import {
  deleteOrderGraph,
  deletionSummary,
  orderDeletionGraph,
} from "./order-deletion";
import { orderSettlement } from "./order-settlement";
import { OrderDetailService } from "./order-detail.service";
import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { OrdersSchema } from "./dto/orders.schema";
import { OrderLifecycleService } from "./order-lifecycle.service";
@Injectable()
export class OrdersService extends ResourceService {
  readonly resource = "orders";
  protected schema = OrdersSchema;
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
    @Inject(OrderLifecycleService)
    readonly lifecycle: OrderLifecycleService,
    @Inject(OrderDetailService) readonly details: OrderDetailService,
  ) {
    super(db, access);
  }
  async detail(a: Actor, key: string) {
    const raw = await this.access.get(a, "orders", key);
    const [record, related] = await Promise.all([
      super.enrich(a, raw),
      this.details.related(a, raw),
    ]);
    const { relatedOperations, ...data } = related;
    return {
      ...record,
      ...data,
      operations: await resolveOperationActors(
        this.db,
        [...this.visibleOperations(a, raw), ...relatedOperations].sort((a, b) =>
          String(a.operatedAt).localeCompare(String(b.operatedAt)),
        ),
      ),
    };
  }
  async enrich(a: Actor, row: any) {
    const result = await super.enrich(a, row);
    if (row.status !== "COMPLETED") return result;
    const bills = await this.db.income.findMany({
      where: { orderId: row.id, recordType: "RECEIVABLE", deletedAt: null },
    });
    const [receipts, expenses, commissions] = await Promise.all([
      this.db.income.findMany({
        where: { parentId: { in: bills.map((b) => b.id) }, deletedAt: null },
      }),
      this.db.expense.findMany({ where: { orderId: row.id, deletedAt: null } }),
      this.db.commission.findMany({
        where: { orderId: row.id, deletedAt: null },
      }),
    ]);
    result.settlement = orderSettlement(
      row,
      bills,
      receipts,
      expenses,
      commissions,
    );
    result.lifecycleStatus = "ENDED";
    return result;
  }
  async deletionPreview(a: Actor, key: string) {
    this.access.allow(a, "orders", true);
    await this.access.get(a, "orders", key);
    return deletionSummary(await orderDeletionGraph(this.db, key));
  }
  async remove(a: Actor, key: string, reason: string) {
    this.access.allow(a, "orders", true);
    if (!reason?.trim()) fail("请填写删除原因");
    return this.db.$transaction(
      async (tx) => {
        const first = await this.access.get(a, "orders", key, tx);
        if (first.unitId) await lock(tx, "units", first.unitId);
        await lock(tx, "orders", key);
        const order = await this.access.get(a, "orders", key, tx);
        return deleteOrderGraph(tx, a, order, reason.trim());
      },
      { timeout: 20000 },
    );
  }
  create(a: Actor, body: any) {
    return this.lifecycle.createOrder(a, body);
  }
  edit(a: Actor, key: string, body: any) {
    return this.lifecycle.editOrder(a, key, body);
  }
}
