import { Inject, Injectable } from "@nestjs/common";
import { z } from "zod";
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
    if ((data.key ?? row?.key) === "unit_types") {
      const values = z
        .array(
          z.object({
            code: z.string().regex(/^[a-zA-Z0-9_-]+$/),
            name: z.string().min(1),
            enabled: z.boolean(),
            sortOrder: z.number().int(),
          }),
        )
        .parse(data.value);
      if (new Set(values.map((x) => x.code)).size !== values.length)
        fail("类型编码重复");
      const old = (row?.value as any[]) ?? [];
      const removed = old.filter((v) => !values.some((x) => x.code === v.code));
      for (const v of removed) {
        if (
          await tx.unit.count({
            where: {
              unitTypeCode: v.code,
            },
          })
        )
          fail("已引用类型只能停用");
        const projects = await tx.project.findMany({
          select: {
            typeConfigs: true,
          },
        });
        if (
          projects.some((p) =>
            (p.typeConfigs as any[]).some((x) => x.code === v.code),
          )
        )
          fail("项目已引用的类型只能停用");
      }
      data.value = values;
    }
  }
  protected async beforeEdit(a: Actor, d: any, tx: any, row: any) {
    if (d.key && d.key !== row.key) fail("配置键不可修改");
  }
  protected async beforeRemove(a: Actor, tx: any, row: any) {
    fail("该业务请使用关闭、作废或停用操作");
  }
}
