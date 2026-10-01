import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
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
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    fail("该业务请使用关闭、作废或停用操作");
  }
}
