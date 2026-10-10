import { Actor } from "../auth/actor";

export function actorSnapshot(actor: Actor) {
  return {
    actorId: actor.id,
    actorName: actor.name,
    actorPhone: actor.phone ?? null,
    actorUsername: actor.username ?? null,
    actorType: actor.system ? "SYSTEM" : "USER",
  };
}

function systemEntry(entry: any) {
  // Old scheduled tasks borrowed an admin ID but used this reserved name.
  return (
    entry.actorType === "SYSTEM" ||
    (!entry.actorType && entry.actorName === "系统任务")
  );
}

/** Resolve only authorized entries, in one query. Never rewrite audit snapshots. */
export async function resolveOperationActors(db: any, entries: any[]) {
  const ids = [
    ...new Set(
      entries
        .filter((entry) => !systemEntry(entry))
        .map((entry) => entry.actorId)
        .filter((id) => typeof id === "string" && id),
    ),
  ];
  const users: any[] = ids.length
    ? await db.user.findMany({
        where: { id: { in: ids } },
        // Include soft-deleted accounts, but never select credentials or permissions.
        select: {
          id: true,
          name: true,
          phone: true,
          username: true,
          deletedAt: true,
        },
      })
    : [];
  const byId = new Map(users.map((user) => [user.id, user]));
  return entries.map((entry) => {
    if (systemEntry(entry))
      return {
        ...entry,
        actorType: "SYSTEM",
        actorName: "系统",
        actorPhone: null,
        actorUsername: null,
        actorDeleted: false,
      };
    const user = byId.get(entry.actorId);
    return {
      ...entry,
      actorType: "USER",
      actorName:
        user?.name ?? entry.actorName ?? entry.operator ?? "未知操作人",
      actorPhone: user ? user.phone : (entry.actorPhone ?? null),
      actorUsername: user ? user.username : (entry.actorUsername ?? null),
      actorDeleted: user ? Boolean(user.deletedAt) : Boolean(entry.actorId),
    };
  });
}

/** Recover legacy payment identities only from the event that appended them. */
export function paymentActors(records: any[], logs: any[], fallback: boolean) {
  return records.map((record, index) => {
    if (record.actorId) return record;
    const log = logs.find((entry) => {
      if (fallback)
        return (
          entry.changes?.paidAmount &&
          Number(entry.changes.paidAmount.after) >
            Number(entry.changes.paidAmount.before ?? 0)
        );
      const before = entry.changes?.paymentRecords?.before;
      const after = entry.changes?.paymentRecords?.after;
      if (
        !Array.isArray(after) ||
        index < (Array.isArray(before) ? before.length : 0)
      )
        return false;
      const added = after[index];
      return (
        added &&
        (record.sourceKey
          ? added.sourceKey === record.sourceKey
          : [
              "amount",
              "paidOn",
              "fundAccountId",
              "paymentMethod",
              "bankReference",
              "operator",
            ].every(
              (key) => String(added[key] ?? "") === String(record[key] ?? ""),
            ))
      );
    });
    return log
      ? {
          ...record,
          actorId: log.actorId,
          actorName: log.actorName,
          actorPhone: log.actorPhone,
          actorUsername: log.actorUsername,
          actorType: log.actorType,
        }
      : { ...record, actorName: record.operator ?? "未知操作人" };
  });
}
