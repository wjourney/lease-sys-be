import { ConflictException } from "@nestjs/common";
import { Actor } from "../auth/actor";
import { delegate, tables } from "../resources/resource-map";
import { fail } from "../utils/errors";
import { id, plain } from "../utils/value";
export function event(
  actor: Actor,
  action: string,
  before: any,
  after: any,
  reason?: string,
) {
  const skip = [
    "operationLogs",
    "passwordHash",
    "password",
    "authVersion",
    "updatedAt",
    "createdAt",
  ];
  const changes: any = {};
  for (const k of Object.keys(after)) {
    if (skip.includes(k)) continue;
    if (
      JSON.stringify(plain(before?.[k] ?? null)) !==
      JSON.stringify(plain(after[k] ?? null))
    )
      changes[k] = {
        before: plain(before?.[k] ?? null),
        after: plain(after[k] ?? null),
      };
  }
  return {
    eventId: id(),
    action,
    actorId: actor.id,
    actorName: actor.name,
    operatedAt: new Date().toISOString(),
    changes,
    reason: reason ?? "",
    operationId: id(),
  };
}
export async function insert(tx: any, resource: string, data: any, a: Actor) {
  return tx[delegate[resource]].create({
    data: {
      ...data,
      createdBy: a.id,
      updatedBy: a.id,
      operationLogs: [event(a, "CREATE", null, data)],
    },
  });
}
export async function update(
  tx: any,
  resource: string,
  row: any,
  data: any,
  a: Actor,
  reason?: string,
) {
  const logs = Array.isArray(row.operationLogs) ? row.operationLogs : [];
  const r = await tx[delegate[resource]].updateMany({
    where: { id: row.id, revision: row.revision },
    data: {
      ...data,
      revision: { increment: 1 },
      updatedBy: a.id,
      operationLogs: [
        ...logs,
        event(a, data.deletedAt ? "DELETE" : "UPDATE", row, data, reason),
      ],
    },
  });
  if (r.count !== 1)
    throw new ConflictException("记录已被其他人修改，请刷新后重试");
  return tx[delegate[resource]].findUnique({ where: { id: row.id } });
}
export async function lock(tx: any, resource: string, key: string) {
  if (!tables[resource]) fail("未知资源");
  await tx.$queryRawUnsafe(
    `SELECT id FROM "${tables[resource]}" WHERE id=$1::uuid FOR UPDATE`,
    key,
  );
}
