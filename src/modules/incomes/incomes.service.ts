import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { number, plain } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { IncomesSchema } from "./dto/incomes.schema";
import { IncomeBalanceService } from "./income-balance.service";
@Injectable()
export class IncomesService extends ResourceService {
  readonly resource = "incomes";
  protected schema = IncomesSchema;
  protected prefix: [string, string] = ["recordNo", "B"];
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
    @Inject(IncomeBalanceService)
    readonly balances: IncomeBalanceService,
  ) {
    super(db, access);
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    if (data.orderId) {
      const o = await this.access.get(a, "orders", data.orderId, tx);
      data.projectId = o.projectId;
      data.unitId = o.unitId;
    } else if (data.unitId) {
      const u = await this.access.get(a, "units", data.unitId, tx);
      data.projectId = u.projectId;
    } else if (data.projectId)
      await this.access.get(a, "projects", data.projectId, tx);
    if (data.amount && number(data.amount).lte(0)) fail("金额必须大于零");
  }
  async edit(_a: Actor, _key: string, _body: any): Promise<never> {
    return fail("应收记录不可直接编辑，请通过来源业务处理");
  }
  async create(_a: Actor, _body: any): Promise<never> {
    return fail("请通过订单新增费用，不能直接新增应收");
  }
  protected async beforeRemove() {
    fail("应收和收款记录不能删除，请使用来源业务或收款撤回、冲正");
  }
  async detail(a: Actor, key: string) {
    const result = await super.detail(a, key);
    if (result.recordType !== "RECEIPT") return result;
    const group = result.recurrenceRule?.receiptGroupId;
    const members = group
      ? await this.db.income.findMany({
          where: {
            orderId: result.orderId,
            recordType: "RECEIPT",
            deletedAt: null,
            sourceKey: {
              startsWith: `${result.sourceKey.startsWith("initial:") ? "initial" : "payment"}:${group}:`,
            },
          },
          select: { id: true },
        })
      : [{ id: key }];
    const vouchers = await this.db.material.findMany({
      where: {
        AND: [
          {
            incomeId: { in: members.map((r) => r.id) },
            deletedAt: null,
            isCurrent: true,
          },
          await this.access.scope(a, "materials"),
        ],
      },
      orderBy: { createdAt: "desc" },
    });
    return {
      ...result,
      vouchers: await Promise.all(
        vouchers.map((v) => this.access.output(a, "materials", v)),
      ),
    };
  }
  async enrich(a: Actor, row: any) {
    const x = await super.enrich(a, row);
    if (row.recordType !== "RECEIVABLE") {
      const parent = row.parentId
        ? await this.db.income.findUnique({ where: { id: row.parentId } })
        : null;
      if (parent?.orderId) {
        const order = await this.db.order.findUnique({
          where: { id: parent.orderId },
        });
        x.orderId = parent.orderId;
        x.orderNo = order?.orderNo;
      }
      x.billNo = parent?.recordNo;
      x.voucherIncomeId = row.recurrenceRule?.voucherIncomeId || row.id;
      if (row.fundAccountId) {
        const account = await this.db.fundAccount.findUnique({
          where: { id: row.fundAccountId },
        });
        x.accountName = account?.name;
      }
      return x;
    }
    const t = await this.balances.totals(this.db, row.id);
    Object.assign(x, plain(t));
    x.overdue =
      row.status !== "VOID" &&
      t.remaining.gt(0) &&
      !!row.dueOn &&
      row.dueOn.toISOString().slice(0, 10) <
        new Date().toISOString().slice(0, 10);
    return x;
  }
}
