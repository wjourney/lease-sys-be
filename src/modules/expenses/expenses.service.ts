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
      row.commissionId ||
      ["DEPOSIT_REFUND", "RENT_REFUND"].includes(row.feeType)
    )
      fail("已付款或自动生成的支出不能直接修改");
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    if (
      row.status === "PAID" ||
      row.commissionId ||
      ["DEPOSIT_REFUND", "RENT_REFUND"].includes(row.feeType)
    )
      fail("已付款或自动产生的支出不能删除");
  }
}
