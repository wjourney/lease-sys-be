import { ConflictException, Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
import { AccessService } from "../../common/auth/access.service";
import { Actor, financial } from "../../common/auth/actor";
import { lock, update } from "../../common/database/record-mutations";
import { ResourceService } from "../../common/resources/resource.service";
import { demand, fail } from "../../common/utils/errors";
import { plusMonths } from "../../common/utils/rent-period";
import { number, plain } from "../../common/utils/value";
import { money } from "../../common/validation/fields";
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
  protected async beforeEdit(a: Actor, d: any, tx: any, row: any) {
    const key = row.id;
    if (row.recordType !== "RECEIVABLE" || row.status === "VOID")
      fail("只能修改有效应收主记录");
    const n = await tx.income.count({
      where: {
        parentId: key,
        status: {
          in: ["PENDING", "CONFIRMED"],
        },
        deletedAt: null,
      },
    });
    if (n) fail("已有待确认或已确认收款，不能直接修改应收，请使用财务调整");
    if (d.recurrenceRule)
      d.nextGenerationOn =
        d.recurrenceRule.frequency === "MONTHLY"
          ? plusMonths(d.dueOn ?? row.dueOn, 1)
          : null;
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    const key = row.id;
    if (
      row.recordType !== "RECEIVABLE" ||
      (await tx.income.count({
        where: {
          parentId: key,
          status: {
            in: ["PENDING", "CONFIRMED"],
          },
        },
      }))
    )
      fail("实际收款及已有收款的应收不能删除");
  }
  protected async beforeCreate(a: Actor, d: any, tx: any) {
    d.recordType = "RECEIVABLE";
    if (d.recurrenceRule?.frequency === "MONTHLY")
      d.nextGenerationOn = plusMonths(d.dueOn, 1);
  }
  async adjust(a: Actor, key: string, body: any) {
    demand(financial(a));
    const d = z
      .object({
        amount: money,
        reason: z.string().min(1),
        revision: z.number().int(),
      })
      .strict()
      .parse(body);
    return this.db.$transaction(async (tx) => {
      await lock(tx, "incomes", key);
      const row = await this.access.get(a, "incomes", key, tx);
      if (row.recordType !== "RECEIVABLE" || row.status === "VOID")
        fail("请选择有效应收");
      if (row.revision !== d.revision)
        throw new ConflictException("记录已更新");
      const totals = await this.balances.totals(tx, key);
      if (number(d.amount).lt(totals.confirmed.add(totals.pending)))
        fail("调整后应收不能小于已确认及待确认金额");
      return update(
        tx,
        "incomes",
        row,
        {
          adjustmentAmount: number(d.amount).sub(row.amount),
          status: number(d.amount).eq(totals.confirmed)
            ? "PAID"
            : totals.confirmed.gt(0)
              ? "PARTIAL"
              : "OPEN",
        },
        a,
        d.reason,
      );
    });
  }
  async enrich(a: Actor, row: any) {
    const x = await super.enrich(a, row);
    if (row.recordType !== "RECEIVABLE") return x;
    const t = await this.balances.totals(this.db, row.id);
    Object.assign(x, plain(t));
    return x;
  }
}
