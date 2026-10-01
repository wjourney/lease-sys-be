import "dotenv/config";
import { PrismaService } from "../database/prisma.service";
import { checksum, StorageService } from "../common/storage/storage.service";

export async function migrateLocalFiles(
  db: PrismaService,
  storage: StorageService,
  apply = false,
) {
  if (apply && storage.provider !== "OSS")
    throw new Error("Set STORAGE_PROVIDER=OSS before applying migration");
  const materials = await db.material.findMany({
    where: { storageProvider: "LOCAL", storageKey: { not: null } },
    select: {
      storageKey: true,
      checksum: true,
      sizeBytes: true,
      mimeType: true,
    },
  });
  const users = await db.user.findMany({
    where: { avatarStorageProvider: "LOCAL", avatarStorageKey: { not: null } },
    select: { avatarStorageKey: true, avatarMimeType: true },
  });
  const keys = new Set([
    ...materials.map((m) => m.storageKey!),
    ...users.map((u) => u.avatarStorageKey!),
  ]);
  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      localMaterialRecords: materials.length,
      localAvatarRecords: users.length,
      uniqueFiles: keys.size,
    }),
  );
  let migrated = 0;
  for (const key of keys) {
    const matching = materials.filter((m) => m.storageKey === key);
    const buffer = await storage.read({
      storageProvider: "LOCAL",
      storageKey: key,
    });
    const digest = checksum(buffer);
    if (
      matching.some(
        (m) =>
          (m.checksum && m.checksum !== digest) ||
          (m.sizeBytes !== null && m.sizeBytes !== buffer.length),
      )
    )
      throw new Error(
        "Local checksum/size mismatch; migration stopped without switching this file",
      );
    if (!apply) continue;
    const mime =
      matching[0]?.mimeType ||
      users.find((u) => u.avatarStorageKey === key)?.avatarMimeType ||
      "application/octet-stream";
    const target = await storage.save(buffer, mime, "OSS");
    try {
      const copy = await storage.read(target);
      if (copy.length !== buffer.length || checksum(copy) !== digest)
        throw new Error("OSS read-back checksum mismatch");
      // Include history and soft-deleted rows. Never overwrite concurrent new uploads.
      await db.$transaction(async (tx) => {
        await tx.material.updateMany({
          where: { storageProvider: "LOCAL", storageKey: key },
          data: { storageProvider: "OSS", storageKey: target.storageKey },
        });
        await tx.user.updateMany({
          where: { avatarStorageProvider: "LOCAL", avatarStorageKey: key },
          data: {
            avatarStorageProvider: "OSS",
            avatarStorageKey: target.storageKey,
          },
        });
      });
      migrated++;
    } catch (error) {
      await storage.discard(target);
      throw error;
    }
  }
  console.log(
    JSON.stringify({
      verifiedFiles: keys.size,
      migratedFiles: migrated,
      localCopiesRetained: true,
    }),
  );
}
async function main() {
  const db = new PrismaService();
  try {
    await migrateLocalFiles(
      db,
      new StorageService(db),
      process.argv.includes("--apply"),
    );
  } finally {
    await db.$disconnect();
  }
}
if (require.main === module)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
