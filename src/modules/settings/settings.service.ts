import { Inject, Injectable } from "@nestjs/common";
import { AccessService } from "../../common/auth/access.service";
import { Actor } from "../../common/auth/actor";
import { ResourceService } from "../../common/resources/resource.service";
import { fail } from "../../common/utils/errors";
import { PrismaService } from "../../database/prisma.service";
import { SettingsSchema } from "./dto/settings.schema";
@Injectable()
export class SettingsService extends ResourceService {
  readonly resource = "settings";
  protected schema = SettingsSchema;
  constructor(
    @Inject(PrismaService)
    db: PrismaService,
    @Inject(AccessService)
    access: AccessService,
  ) {
    super(db, access);
  }
  protected async validate(a: Actor, data: any, tx: any, row?: any) {
    if ((data.key ?? row?.key) === "website") fail("请使用网站配置页面修改");
    if ((data.key ?? row?.key) === "unit_types")
      fail("单位类型请在所属项目中配置");
  }

  protected async beforeEdit(a: Actor, d: any, tx: any, row: any) {
    if (d.key && d.key !== row.key) fail("配置键不可修改");
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    fail("该业务请使用关闭、作废或停用操作");
  }
}
