import { ConflictException } from "@nestjs/common";
import { z } from "zod";
import { Actor } from "../auth/actor";
import { insert, lock, update } from "../database/record-mutations";
import { fail } from "../utils/errors";
import { serial } from "../utils/value";
import { ResourceQueryService } from "./resource-query.service";
export abstract class ResourceService extends ResourceQueryService {
  protected schema?: z.ZodObject<any>;
  protected prefix?: [string, string];
  protected references: [string, string][] = [];
  protected async validate(
    a: Actor,
    data: any,
    tx: any,
    row?: any,
  ): Promise<void> {}
  protected async beforeCreate(
    a: Actor,
    data: any,
    tx: any,
    options?: { replacingMaterialGroupId?: string },
  ): Promise<void> {}
  protected async beforeEdit(
    a: Actor,
    data: any,
    tx: any,
    row: any,
  ): Promise<void> {}
  protected async beforeRemove(a: Actor, tx: any, row: any): Promise<void> {}
  async create(
    a: Actor,
    body: any,
    options?: { replacingMaterialGroupId?: string },
  ) {
    this.access.allow(a, this.resource, this.resource !== "materials");
    if (!this.schema) return fail("该记录由业务流程生成");
    const d = this.schema.strict().parse(body);
    return this.db.$transaction(async (tx) => {
      await this.validate(a, d, tx);
      if (this.prefix) d[this.prefix[0]] = serial(this.prefix[1]);
      await this.beforeCreate(a, d, tx, options);
      return insert(tx, this.resource, d, a);
    });
  }
  async edit(a: Actor, key: string, body: any) {
    this.access.allow(a, this.resource, true);
    if (!this.schema || this.resource === "materials")
      return fail("请使用此业务的专用操作");
    const { revision, reason, ...rest } = z
      .object({ revision: z.number().int(), reason: z.string().optional() })
      .passthrough()
      .parse(body);
    const d = this.schema.partial().strict().parse(rest);
    return this.db.$transaction(async (tx) => {
      await lock(tx, this.resource, key);
      const row = await this.access.get(a, this.resource, key, tx);
      if (row.revision !== revision)
        throw new ConflictException("记录已更新，请刷新");
      await this.beforeEdit(a, d, tx, row);
      await this.validate(a, d, tx, row);
      return update(tx, this.resource, row, d, a, reason);
    });
  }
  async remove(a: Actor, key: string, reason: string) {
    this.access.allow(a, this.resource, true);
    if (!reason?.trim()) fail("请填写删除原因");
    return this.db.$transaction(async (tx) => {
      await lock(tx, this.resource, key);
      const row = await this.access.get(a, this.resource, key, tx);
      await this.beforeRemove(a, tx, row);
      for (const [model, field] of this.references)
        if (await (tx as any)[model].count({ where: { [field]: key, deletedAt: null } }))
          fail(this.resource === "projects" ? "请先删除项目下的单位" : this.resource === "units" ? "该单位有历史订单记录，不能删除" : "已有业务引用，不能删除");
      return update(
        tx,
        this.resource,
        row,
        {
          deletedAt: new Date(),
          deletedBy: a.id,
          ...(this.resource === "users"
            ? { authVersion: row.authVersion + 1 }
            : {}),
        },
        a,
        reason,
      );
    });
  }
}
