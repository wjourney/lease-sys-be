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
      this.enrich(a, raw),
      this.details.related(a, raw),
    ]);
    const { relatedOperations, ...data } = related;
    return {
      ...record,
      ...data,
      operations: [
        ...this.visibleOperations(a, raw),
        ...relatedOperations,
      ].sort((a, b) =>
        String(a.operatedAt).localeCompare(String(b.operatedAt)),
      ),
    };
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    fail("该业务请使用关闭、作废或停用操作");
  }
  create(a: Actor, body: any) {
    return this.lifecycle.createOrder(a, body);
  }
  edit(a: Actor, key: string, body: any) {
    return this.lifecycle.editOrder(a, key, body);
  }
}
