import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { parseRange } from "../src/common/storage/file-response";
import { StorageService } from "../src/common/storage/storage.service";

function database() {
  const pending: any[] = [];
  const references = new Set<string>();
  return {
    pending,
    references,
    storageCleanup: {
      create: async ({ data }: any) => {
        pending.push({ ...data, id: String(pending.length), attempts: 0 });
      },
      findMany: async () => [...pending],
      upsert: async ({ create, update, where }: any) => {
        assert.deepEqual(Object.keys(where.storageProvider_storageKey).sort(), [
          "storageKey",
          "storageProvider",
        ]);
        const row = pending.find((p) => p.storageKey === create.storageKey);
        if (row) Object.assign(row, update);
        else
          pending.push({ ...create, id: String(pending.length), attempts: 0 });
      },
      updateMany: async ({ where, data }: any) => {
        Object.assign(
          pending.find((p) => p.id === where.id),
          data,
        );
      },
      deleteMany: async ({ where }: any) => {
        const i = pending.findIndex((p) => p.id === where.id);
        if (i >= 0) pending.splice(i, 1);
      },
    },
    material: {
      count: async ({ where }: any) =>
        references.has(where.storageKey) ? 1 : 0,
    },
    user: { count: async () => 0 },
    systemSetting: { findUnique: async (): Promise<any> => null },
  };
}

test("HTTP byte ranges include prefix, suffix, open-ended and unsatisfiable cases", () => {
  assert.deepEqual(parseRange("bytes=0-3", 10), { start: 0, end: 3 });
  assert.deepEqual(parseRange("bytes=7-", 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange("bytes=-3", 10), { start: 7, end: 9 });
  assert.deepEqual(parseRange("bytes=1-99", 10), { start: 1, end: 9 });
  for (const input of [
    "bytes=10-",
    "bytes=-0",
    "bytes=8-2",
    "bytes=9999999999999999999-",
  ])
    assert.equal(parseRange(input, 10), "unsatisfiable");
  assert.equal(parseRange("bytes=0-", 0), "unsatisfiable");
  assert.equal(parseRange("bytes=0-1,4-5", 10), undefined);
  assert.equal(parseRange("bogus", 10), undefined);
});

test("storage cleanup preserves the active website logo only", async () => {
  const db = database();
  db.systemSetting.findUnique = async () => ({
    value: { logo: { storageProvider: "LOCAL", storageKey: "logo" } },
  });
  const storage = new StorageService(db as any);
  assert.equal(
    await storage.referenced({ storageProvider: "LOCAL", storageKey: "logo" }),
    true,
  );
  assert.equal(
    await storage.referenced({
      storageProvider: "LOCAL",
      storageKey: "old-logo",
    }),
    false,
  );
  assert.equal(
    await storage.referenced({ storageProvider: "OSS", storageKey: "logo" }),
    false,
  );
});

test("local storage streams bytes and GC preserves even historical references", async () => {
  const folder = await mkdtemp(join(tmpdir(), "lease-storage-unit-"));
  process.env.UPLOAD_DIR = folder;
  process.env.STORAGE_PROVIDER = "LOCAL";
  const db = database();
  const storage = new StorageService(db as any);
  try {
    const saved = await storage.save(Buffer.from("0123456789"));
    assert.equal(saved.storageProvider, "LOCAL");
    assert.equal(await storage.size(saved), 10);
    const stream = await storage.open(saved, { start: 3, end: 6 });
    const chunks = [];
    for await (const part of stream) chunks.push(part);
    assert.equal(Buffer.concat(chunks).toString(), "3456");
    db.references.add(saved.storageKey);
    await storage.collectGarbage();
    assert.equal(db.pending.length, 0);
    assert.equal((await stat(join(folder, saved.storageKey))).size, 10);
    db.references.delete(saved.storageKey);
    await storage.discard(saved);
    await storage.collectGarbage();
    await assert.rejects(stat(join(folder, saved.storageKey)), {
      code: "ENOENT",
    });
    await assert.rejects(
      storage.size({ storageProvider: "LOCAL", storageKey: "../secret" }),
    );
    await assert.rejects(
      storage.size({
        storageProvider: "INVALID",
        storageKey: saved.storageKey,
      }),
    );
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
});

test("OSS uses private immutable objects, streams Range and never falls back to LOCAL on errors", async () => {
  process.env.STORAGE_PROVIDER = "LOCAL";
  const db = database();
  const storage = new StorageService(db as any);
  const calls: any[] = [];
  let failRead = false;
  (storage as any).client = {
    put: async (...args: any[]) => {
      calls.push(args);
    },
    head: async () => ({ res: { headers: { "content-length": "10" } } }),
    getStream: async (key: string, options: any) => {
      if (failRead)
        throw Object.assign(
          new Error("secret signed request must not escape"),
          { code: "AccessDenied" },
        );
      assert.equal(options.headers.Range, "bytes=3-6");
      return {
        stream: Readable.from([Buffer.from("3456")]),
        res: { status: 206, headers: { "content-length": "4" } },
      };
    },
    delete: async (key: string) => {
      calls.push(["delete", key]);
    },
  };
  const file = await storage.save(
    Buffer.from("0123456789"),
    "video/mp4",
    "OSS",
  );
  assert.equal(file.storageProvider, "OSS");
  assert.equal(calls[0][2].headers["x-oss-object-acl"], "private");
  assert.equal(calls[0][2].headers["x-oss-forbid-overwrite"], "true");
  assert.equal(await storage.size(file), 10);
  const stream = await storage.open(file, { start: 3, end: 6 });
  for await (const part of stream) assert.equal(part.toString(), "3456");
  failRead = true;
  await assert.rejects(
    storage.open(file),
    (e: any) => e.getStatus() === 503 && !e.message.includes("secret"),
  );
  await storage.collectGarbage();
  assert.deepEqual(calls[1], ["delete", file.storageKey]);
});

test("preview URLs use V4 signatures on the public OSS endpoint while local files keep their API URL", async () => {
  const original = {
    provider: process.env.STORAGE_PROVIDER,
    endpoint: process.env.OSS_ENDPOINT,
    bucket: process.env.OSS_BUCKET,
    keyId: process.env.OSS_ACCESS_KEY_ID,
    secret: process.env.OSS_ACCESS_KEY_SECRET,
    publicEndpoint: process.env.OSS_PUBLIC_ENDPOINT,
  };
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  try {
    process.env.STORAGE_PROVIDER = "LOCAL";
    process.env.OSS_ENDPOINT = "https://oss-cn-shanghai-internal.aliyuncs.com";
    process.env.OSS_BUCKET = "example-private-bucket";
    process.env.OSS_ACCESS_KEY_ID = "test-key";
    process.env.OSS_ACCESS_KEY_SECRET = "test-secret";
    delete process.env.OSS_PUBLIC_ENDPOINT;
    const storage = new StorageService(database() as any);
    const fallback = "/api/v1/materials/123/download";
    const localKey = "00000000-0000-0000-0000-000000000001";
    assert.equal(
      await storage.previewUrl(
        { storageProvider: "LOCAL", storageKey: localKey },
        fallback,
      ),
      fallback,
    );
    const url = new URL(
      await storage.previewUrl(
        {
          storageProvider: "OSS",
          storageKey: "lease-sys/dev/" + localKey,
        },
        fallback,
      ),
    );
    assert.equal(
      url.hostname,
      "example-private-bucket.oss-cn-shanghai.aliyuncs.com",
    );
    assert.equal(
      url.searchParams.get("x-oss-signature-version"),
      "OSS4-HMAC-SHA256",
    );
    assert.ok(url.searchParams.has("x-oss-signature"));
    assert.ok(!url.hostname.includes("-internal"));
  } finally {
    restore("STORAGE_PROVIDER", original.provider);
    restore("OSS_ENDPOINT", original.endpoint);
    restore("OSS_BUCKET", original.bucket);
    restore("OSS_ACCESS_KEY_ID", original.keyId);
    restore("OSS_ACCESS_KEY_SECRET", original.secret);
    restore("OSS_PUBLIC_ENDPOINT", original.publicEndpoint);
  }
});

test("failed writes keep a durable cleanup candidate and deletion failures are retried", async () => {
  process.env.STORAGE_PROVIDER = "LOCAL";
  const db = database();
  const storage = new StorageService(db as any);
  (storage as any).client = {
    put: async () => {
      assert.equal(db.pending.length, 1);
      throw { code: "RequestTimeout" };
    },
    delete: async () => {
      throw { code: "RequestTimeout" };
    },
  };
  await assert.rejects(storage.save(Buffer.from("test"), "image/png", "OSS"));
  assert.equal(db.pending.length, 1);
  await storage.collectGarbage();
  assert.equal(db.pending.length, 1);
  assert.equal(db.pending[0].lastError, "RequestTimeout");
  assert.ok(db.pending[0].deleteAfter.getTime() > Date.now());
});

test("migration verifies bytes before switching every shared reference and is restartable", async () => {
  const { migrateLocalFiles } = await import("../src/cli/migrate-storage");
  const { checksum } = await import("../src/common/storage/storage.service");
  const bytes = Buffer.from("historical file");
  const materials = [1, 2].map(() => ({
    storageKey: "old",
    storageProvider: "LOCAL",
    checksum: checksum(bytes),
    sizeBytes: bytes.length,
    mimeType: "application/pdf",
  }));
  const users = [
    {
      avatarStorageKey: "old",
      avatarStorageProvider: "LOCAL",
      avatarMimeType: "image/png",
    },
  ];
  let saves = 0;
  const db: any = {
    material: {
      findMany: async () =>
        materials.filter((m) => m.storageProvider === "LOCAL"),
      updateMany: async ({ where, data }: any) => {
        materials
          .filter(
            (m) =>
              m.storageKey === where.storageKey &&
              m.storageProvider === "LOCAL",
          )
          .forEach((m) => Object.assign(m, data));
      },
    },
    user: {
      findMany: async () =>
        users.filter((u) => u.avatarStorageProvider === "LOCAL"),
      updateMany: async ({ where, data }: any) => {
        users
          .filter(
            (u) =>
              u.avatarStorageKey === where.avatarStorageKey &&
              u.avatarStorageProvider === "LOCAL",
          )
          .forEach((u) => Object.assign(u, data));
      },
    },
    $transaction: async (run: any) => run(db),
  };
  const storage: any = {
    provider: "OSS",
    read: async () => bytes,
    save: async () => {
      saves++;
      return { storageProvider: "OSS", storageKey: "new" };
    },
  };
  await migrateLocalFiles(db, storage, false);
  assert.equal(saves, 0);
  assert.equal(materials[0].storageProvider, "LOCAL");
  await migrateLocalFiles(db, storage, true);
  assert.equal(saves, 1);
  assert(
    materials.every(
      (m) => m.storageProvider === "OSS" && m.storageKey === "new",
    ),
  );
  assert.equal(users[0].avatarStorageProvider, "OSS");
  await migrateLocalFiles(db, storage, true);
  assert.equal(saves, 1);
});

test("migration rejects a corrupt OSS copy without updating database references", async () => {
  const { migrateLocalFiles } = await import("../src/cli/migrate-storage");
  let cleaned = false;
  const db: any = {
    material: { findMany: async () => [{ storageKey: "old", sizeBytes: 3 }] },
    user: { findMany: async () => [] },
    $transaction: async () => assert.fail("Corrupt file must not be attached"),
  };
  const storage: any = {
    provider: "OSS",
    read: async (ref: any) =>
      Buffer.from(ref.storageProvider === "LOCAL" ? "abc" : "bad"),
    save: async () => ({ storageProvider: "OSS", storageKey: "new" }),
    discard: async () => {
      cleaned = true;
    },
  };
  await assert.rejects(
    migrateLocalFiles(db, storage, true),
    /checksum mismatch/,
  );
  assert.equal(cleaned, true);
});
