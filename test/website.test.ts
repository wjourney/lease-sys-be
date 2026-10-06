import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ForbiddenException } from "@nestjs/common";
import {
  WebsiteService,
  WebsiteInput,
  websiteDefaults,
  logoMime,
} from "../src/modules/settings/website.service";
import { WebsiteController } from "../src/modules/settings/website.controller";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { SettingsController } from "../src/modules/settings/settings.controller";
import { SettingsService } from "../src/modules/settings/settings.service";

const actor: any = { id: "admin", name: "管理员" };
const payload = { ...websiteDefaults, revision: 0 };
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWZkAAAAASUVORK5CYII=",
  "base64",
);
const file: any = { buffer: png, size: png.length, mimetype: "image/png" };

test("HTTP website routes bypass generic record IDs and accept logo uploads", async () => {
  const f = fixture();
  @Module({
    controllers: [SettingsController, WebsiteController],
    providers: [
      { provide: WebsiteService, useValue: f.service },
      { provide: SettingsService, useValue: { detail: () => assert.fail("Website route must not be treated as a record ID") } },
    ],
  })
  class TestModule {}
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix("api/v1");
  app.use((req: any, _res: any, next: any) => { req.actor = actor; next(); });
  await app.listen(0, "127.0.0.1");
  try {
    const base = await app.getUrl();
    for (const path of ["/site-config", "/settings/website"]) {
      const response = await fetch(base + "/api/v1" + path);
      assert.equal(response.status, 200);
      assert.equal((await response.json()).siteName, websiteDefaults.siteName);
    }
    const body = new FormData();
    body.set("payload", JSON.stringify(payload));
    body.set("file", new Blob([new Uint8Array(png)], { type: "image/png" }), "logo.png");
    const response = await fetch(base + "/api/v1/settings/website", { method: "POST", body });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).logoUrl, "https://assets.example/logo-1");
  } finally {
    await app.close();
  }
});
function fixture(initial?: any) {
  let row: any = initial;
  const cleanup: any[] = [],
    discarded: any[] = [];
  let uploads = 0;
  const db: any = {
    systemSetting: {
      findUnique: async () => row,
      create: async ({ data }: any) =>
        (row = { ...data, id: "site", revision: 1 }),
      updateMany: async ({ data, where }: any) => {
        assert.equal(where.revision, row.revision);
        row = { ...row, ...data, revision: row.revision + 1 };
        return { count: 1 };
      },
    },
    storageCleanup: { upsert: async (data: any) => cleanup.push(data) },
    $queryRawUnsafe: async () => [],
    $transaction: async (run: any) => run(db),
  };
  const storage: any = {
    save: async () => ({
      storageProvider: "OSS",
      storageKey: "logo-" + ++uploads,
    }),
    previewUrl: async (ref: any) => "https://assets.example/" + ref.storageKey,
    discard: async (ref: any) => discarded.push(ref),
  };
  const access: any = {
    allow: (a: any) => {
      if (a !== actor) throw new ForbiddenException();
    },
  };
  return {
    service: new WebsiteService(db, access, storage),
    db,
    cleanup,
    discarded,
    row: () => row,
    uploads: () => uploads,
  };
}
test("public config exposes only branding fields and works before configuration exists", async () => {
  const fresh = fixture();
  assert.deepEqual(await fresh.service.read(), {
    ...websiteDefaults,
    revision: 0,
    logoUrl: null,
  });
  const f = fixture({
    revision: 5,
    value: {
      ...websiteDefaults,
      internal: "secret",
      logo: { storageProvider: "OSS", storageKey: "brand" },
    },
  });
  assert.deepEqual(await f.service.read(), {
    ...websiteDefaults,
    revision: 5,
    logoUrl: "https://assets.example/brand",
  });
  assert.equal(
    Reflect.getMetadata("public", WebsiteController.prototype.read),
    true,
  );
  assert.equal(
    Reflect.getMetadata("public", WebsiteController.prototype.logo),
    true,
  );
});
test("admin can create, edit, replace and remove the logo without losing text settings", async () => {
  const f = fixture();
  const created = await f.service.save(
    actor,
    JSON.stringify({ ...payload, siteName: "海湾租赁" }),
    file,
  );
  assert.equal(created.revision, 1);
  assert.equal(created.logoUrl, "https://assets.example/logo-1");
  assert.equal(f.row().operationLogs[0].actorId, actor.id);
  await f.service.save(actor, {
    ...payload,
    revision: 1,
    siteName: "海湾物业",
  });
  assert.equal(f.row().value.logo.storageKey, "logo-1");
  assert.equal(f.cleanup.length, 0);
  await f.service.save(actor, { ...payload, revision: 2 }, file);
  assert.equal(f.cleanup[0].create.storageKey, "logo-1");
  const removed = await f.service.save(actor, {
    ...payload,
    revision: 3,
    removeLogo: true,
  });
  assert.equal(removed.logoUrl, null);
  assert.equal(f.cleanup[1].create.storageKey, "logo-2");
});
test("stale saves reject conflicts and schedule unused uploads for cleanup", async () => {
  const f = fixture({ id: "site", revision: 3, value: websiteDefaults });
  await assert.rejects(
    f.service.save(actor, payload, file),
    (e: any) => e.getStatus() === 409,
  );
  assert.equal(f.row().revision, 3);
  assert.equal(f.discarded[0].storageKey, "logo-1");
});
test("configuration validates permissions and file content before storing uploads", async () => {
  const f = fixture();
  await assert.rejects(
    f.service.adminRead({} as any),
    (e: any) => e.getStatus() === 403,
  );
  await assert.rejects(
    f.service.save({} as any, payload, file),
    (e: any) => e.getStatus() === 403,
  );
  await assert.rejects(
    f.service.save(actor, payload, {
      ...file,
      buffer: Buffer.from("<svg>invalid</svg>"),
    }),
  );
  await assert.rejects(
    f.service.save(actor, payload, { ...file, size: 3 * 1024 * 1024 }),
  );
  await assert.rejects(
    f.service.save(actor, { ...payload, removeLogo: true }, file),
  );
  assert.equal(f.uploads(), 0);
  assert.equal(
    WebsiteInput.safeParse({ ...payload, siteName: "  " }).success,
    false,
  );
  assert.equal(
    WebsiteInput.safeParse({ ...payload, unexpected: true }).success,
    false,
  );
  assert.equal(logoMime(png), "image/png");
  assert.equal(logoMime(Buffer.from("<svg>invalid</svg>")), null);
});
