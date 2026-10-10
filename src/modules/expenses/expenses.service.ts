import {
  paymentActors,
  resolveOperationActors,
} from "../../common/database/operation-actors";
import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
import { PrismaService } from "../../database/prisma.service";
import { ExpensesSchema } from "./dto/expenses.schema";
@Injectable()
export class ExpensesService extends ResourceService {
  readonly resource = "expenses";
  protected schema = ExpensesSchema;
  protected prefix: [string, string] = ["expenseNo", "E"];
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
  ) {
    super(db, access);
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    if (!row && data.feeType === "DEPOSIT_REFUND")
      fail("押金退款请通过订单结算生成");
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
    if (
      row.status !== "UNPAID" ||
      number(row.paidAmount).gt(0) ||
      row.commissionId ||
      ["DEPOSIT_REFUND", "RENT_REFUND"].includes(row.feeType)
    )
      fail("已付款或自动生成的支出不能直接修改");
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    if (
      row.status === "PAID" ||
      number(row.paidAmount).gt(0) ||
      row.commissionId ||
      ["DEPOSIT_REFUND", "RENT_REFUND"].includes(row.feeType)
    )
      fail("已付款或自动产生的支出不能删除");
  }
  async detail(a: Actor, key: string) {
    const raw = await this.access.get(a, this.resource, key);
    const result = await this.enrich(a, raw);
    const logs = this.visibleOperations(a, raw);
    const original =
      Array.isArray(raw.paymentRecords) && raw.paymentRecords.length
        ? raw.paymentRecords
        : result.paymentRecords;
    const identities = paymentActors(
      original,
      logs,
      !raw.paymentRecords?.length,
    );
    const enriched = await resolveOperationActors(this.db, [
      ...logs,
      ...identities,
    ]);
    return {
      ...result,
      operations: enriched.slice(0, logs.length),
      paymentRecords: result.paymentRecords.map(
        (record: any, index: number) => ({
          ...record,
          ...enriched[logs.length + index],
          accountName: record.accountName,
        }),
      ),
    };
  }
  async enrich(a: Actor, row: any) {
    const result = await super.enrich(a, row);
    const records =
      Array.isArray(row.paymentRecords) && row.paymentRecords.length
        ? row.paymentRecords
        : number(row.paidAmount).gt(0)
          ? [
              {
                amount: row.paidAmount,
                paidOn: row.paidOn,
                fundAccountId: row.fundAccountId,
                paymentMethod: row.paymentMethod,
                bankReference: row.bankReference,
              },
            ]
          : [];
    const accounts = await this.db.fundAccount.findMany({
      where: {
        id: { in: records.map((r: any) => r.fundAccountId).filter(Boolean) },
      },
      select: { id: true, name: true },
    });
    const names = new Map(accounts.map((x) => [x.id, x.name]));
    return {
      ...result,
      remainingAmount: number(row.amount).sub(row.paidAmount).toString(),
      paymentRecords: records.map((p: any) => ({
        ...p,
        accountName: names.get(p.fundAccountId) || "—",
      })),
    };
  }
}
