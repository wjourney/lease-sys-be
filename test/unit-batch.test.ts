import { signBatchMedia, readBatchMedia } from "../src/modules/units/batch-media";
import { uploadFileType } from "../src/modules/materials/upload-file-type";
process.env.JWT_SECRET ||= "unit-batch-media-test-secret-at-least-32-chars";
import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { UnitsService } from "../src/modules/units/units.service";
import { AccessService } from "../src/common/auth/access.service";
const actor: any = { id: randomUUID(), name: "管理员", role: "SUPER_ADMIN" };
const projectId = randomUUID();
const type = { code: "L", name: "大单位", building: "A座", floor: "3", area: "40", layout: "两房", age: 3, minRent: "100", maxRent: "200", referenceRent: "150" };
function fixture() {
  const state: any = { units: [], batches: [], materials: [] };
  let failInsert = false;
  let failMaterial = false;
  const db: any = { $transaction: async (fn: any) => {
    const snapshot = structuredClone(state);
    const tx: any = {
      $queryRawUnsafe: async () => [],
      project: { findFirst: async () => ({ id: projectId, typeConfigs: [type] }) },
      unit: {
        findMany: async () => state.units,
        findFirst: async ({ where }: any) => state.units.find((u: any) => u.projectId === where.projectId && where.OR.some((w: any) => w.unitNo ? u.unitNo === w.unitNo : u.building === w.building && u.floor === w.floor && u.roomNo === w.roomNo)),
        create: async ({ data }: any) => { if (failInsert && state.units.length === 1) throw new Error("disk failure"); const unit = { id: randomUUID(), ...data }; state.units.push(unit); return unit; },
      },
      material: { create: async ({ data }: any) => {
        if (failMaterial && state.materials.length === 1) throw new Error("material failure");
        const material = { id: randomUUID(), materialGroupId: randomUUID(), ...data }; state.materials.push(material); return material;
      } },
      unitCreationBatch: {
        findUnique: async ({ where }: any) => state.batches.find((b: any) => b.id === where.id),
        create: async ({ data }: any) => { state.batches.push(data); return data; },
      },
    };
    try { return await fn(tx); } catch (e) { Object.assign(state, snapshot); throw e; }
  } };
  return { state, service: new UnitsService(db, new AccessService(db), { size: async () => 10 } as any), fail: () => { failInsert = true; }, failMedia: () => { failMaterial = true; } };
}
function body() { return { requestId: randomUUID(), projectId, rows: ["01", "02"].map(roomNo => ({ roomNo, unitTypeCode: "L" })) }; }
test("batch preview writes nothing; creation inherits metadata and audits each unit; retry returns the same units", async () => {
  const { service, state } = fixture(); const input = body();
  assert.equal((await service.batch(actor, input, true)).ok, true); assert.equal(state.units.length, 0);
  const result = await service.batch(actor, input); assert.equal(result.count, 2);
  for (const u of state.units) { assert.equal(u.floor, "3"); assert.equal(u.area, "40"); assert.equal(u.referenceRent, "150"); assert.equal(u.operationLogs[0].action, "CREATE"); }
  const retry = await service.batch(actor, input); assert.equal(retry.replayed, true); assert.deepEqual(retry.unitIds, result.unitIds); assert.equal(state.units.length, 2);
  await assert.rejects(service.batch(actor, { ...input, rows: [input.rows[0]] }), /重复提交编号冲突/);
  await assert.rejects(service.batch({ ...actor, id: randomUUID() }, input), /重复提交编号冲突/);
});
test("batch reports row errors and saves no valid subset", async () => {
  for (const patch of [{ roomNo: "01" }, { unitTypeCode: "UNKNOWN" }]) {
    const { service, state } = fixture(); const input = body(); Object.assign(input.rows[1], patch);
    const result = await service.batch(actor, input); assert.equal(result.ok, false); assert.equal(result.issues?.[0].row, 1); assert.equal(state.units.length, 0); assert.equal(state.batches.length, 0);
  }
});
test("existing and deleted unit room numbers cannot be recreated", async () => {
  const { service, state } = fixture(); await service.batch(actor, body()); state.units[0].deletedAt = new Date();
  const result = await service.batch(actor, body()); assert.equal(result.ok, false); assert.equal(result.issues?.length, 2); assert.equal(state.units.length, 2);
});
test("unexpected insertion failure rolls back entire batch and allows retry", async () => {
  const { service, state, fail } = fixture(); fail();
  await assert.rejects(service.batch(actor, body()), /disk failure/); assert.equal(state.units.length, 0); assert.equal(state.batches.length, 0);
});
test("batch only allows existing unit writers", async () => {
  const { service } = fixture();
  for (const role of ["SALES", "SALES_COMPANY_ADMIN", "FINANCE"]) await assert.rejects(service.batch({ ...actor, role }, body()), /无权/);
  assert.equal((await service.batch({ ...actor, role: "OPERATIONS" }, body())).ok, true);
});
test("strict batch schema rejects forged inherited fields, empty and oversized batches", async () => {
  const { service } = fixture(); const input = body();
  for (const rows of [[], Array.from({ length: 101 }, () => input.rows[0]), [{ ...input.rows[0], floor: "999" }]]) await assert.rejects(service.batch(actor, { ...input, rows }));
});
test("an occupied unit cannot be deleted even when the API is called directly", async () => {
  const { service } = fixture();
  const beforeRemove = (service as any).beforeRemove.bind(service);
  const unit = { id: randomUUID() };
  await assert.rejects(
    beforeRemove(actor, { order: { findFirst: async () => ({ id: randomUUID() }) } }, unit),
    /已租单位不能删除/,
  );
  await beforeRemove(actor, { order: { findFirst: async () => null } }, unit);
});

const mediaFile = (category: "PHOTO" | "VIDEO" | "PROJECT_FILE") => ({ category, originalName: "共用资料", storageProvider: "LOCAL", storageKey: randomUUID(), sizeBytes: 10, checksum: "abc", mimeType: category === "VIDEO" ? "video/mp4" : category === "PHOTO" ? "image/png" : "application/pdf" });
test("all units receive independently editable materials; replay never duplicates them", async () => {
  const { service, state } = fixture();
  const files = (["PHOTO", "VIDEO", "PROJECT_FILE"] as const).map(mediaFile);
  const input = { ...body(), mediaTokens: files.map(f => signBatchMedia(actor.id, projectId, f)) };
  await service.batch(actor, input, true); assert.equal(state.materials.length, 0);
  const result = await service.batch(actor, input);
  assert.equal(state.materials.length, 6);
  assert.equal(new Set(state.materials.map((m: any) => m.materialGroupId)).size, 6);
  for (const unitId of result.unitIds!) {
    const materials = state.materials.filter((m: any) => m.unitId === unitId);
    assert.deepEqual(materials.map((m: any) => m.storageKey), files.map(f => f.storageKey));
    assert.deepEqual(materials.map((m: any) => m.sortOrder), [0, 1, 2]);
    assert(materials.every((m: any) => m.createdBy === actor.id && m.visibility === "SHARED" && !m.projectId));
  }
  await service.batch(actor, input); assert.equal(state.materials.length, 6);
  await assert.rejects(service.batch(actor, { ...input, mediaTokens: [input.mediaTokens[0]] }), /重复提交编号冲突/);
});
test("invalid, mismatched, duplicate or oversized media tickets cannot create units", async () => {
  const valid = signBatchMedia(actor.id, projectId, mediaFile("PHOTO"));
  const tokens = [["forged"], [signBatchMedia(randomUUID(), projectId, mediaFile("PHOTO"))], [signBatchMedia(actor.id, randomUUID(), mediaFile("PHOTO"))], [valid, valid], Array(31).fill(valid)];
  for (const mediaTokens of tokens) {
    const { service, state } = fixture();
    await assert.rejects(service.batch(actor, { ...body(), mediaTokens }));
    assert.equal(state.units.length, 0); assert.equal(state.materials.length, 0);
  }
  assert.throws(() => readBatchMedia(valid.slice(0, -5), actor.id, projectId), /已过期或归属不匹配/);
});
test("material failure rolls back units, materials and retry marker together", async () => {
  const { service, state, failMedia } = fixture(); failMedia();
  const input = { ...body(), mediaTokens: [signBatchMedia(actor.id, projectId, mediaFile("PHOTO"))] };
  await assert.rejects(service.batch(actor, input), /material failure/);
  assert.deepEqual(state, { units: [], batches: [], materials: [] });
});
test("batch upload checks permissions, ownership and actual file type before saving", async () => {
  const { service } = fixture();
  let saves = 0;
  (service as any).db.project = { findFirst: async () => ({ id: projectId }) };
  (service as any).storage.save = async () => { saves++; return mediaFile("PHOTO"); };
  const file: any = { size: 10, buffer: Buffer.from([0x89, 0x50, 0x4e, 0x47]), originalname: "照片.png" };
  const uploaded = await service.uploadBatchMedia(actor, { projectId, category: "PHOTO" }, file);
  assert.equal(readBatchMedia(uploaded.token, actor.id, projectId).originalName, "照片.png");
  for (const role of ["SALES", "SALES_COMPANY_ADMIN", "FINANCE"]) await assert.rejects(service.uploadBatchMedia({ ...actor, role }, { projectId, category: "PHOTO" }, file));
  await assert.rejects(service.uploadBatchMedia(actor, { projectId, category: "VIDEO" }, file), /仅支持 MP4/);
  await assert.rejects(service.uploadBatchMedia(actor, { projectId, category: "PHOTO" }, { ...file, size: 31 * 1024 * 1024 }), /30MB/);
  (service as any).db.project.findFirst = async () => null;
  await assert.rejects(service.uploadBatchMedia(actor, { projectId, category: "PHOTO" }, file), /记录不存在/);
  assert.equal(saves, 1);
  assert.throws(() => uploadFileType({ ...file, buffer: Buffer.from("fake") }, "PHOTO"), /支持 PDF/);
});

test("expired upload tickets are rejected before any units are created", async () => {
  const now = Date.now;
  let token: string;
  try { Date.now = () => now() - 24 * 3600000; token = signBatchMedia(actor.id, projectId, mediaFile("PHOTO")); }
  finally { Date.now = now; }
  const { service, state } = fixture();
  await assert.rejects(service.batch(actor, { ...body(), mediaTokens: [token!] }), /已过期/);
  assert.equal(state.units.length, 0);
});

test("per-unit materials override shared files, including explicit removal, and replay detects changed assignments", async () => {
  const { service, state } = fixture();
  const files = [mediaFile("PHOTO"), mediaFile("VIDEO"), mediaFile("PROJECT_FILE")];
  const input = { ...body(), mediaTokens: files.map(f => signBatchMedia(actor.id, projectId, f)), sharedMediaIndexes: [0, 1], rows: [{ roomNo: "01", unitTypeCode: "L" }, { roomNo: "02", unitTypeCode: "L", mediaIndexes: [2, 0] }, { roomNo: "03", unitTypeCode: "L", mediaIndexes: [] }] };
  const result = await service.batch(actor, input);
  assert.deepEqual(state.materials.filter((m: any) => m.unitId === result.unitIds![0]).map((m: any) => m.storageKey), files.slice(0, 2).map(f => f.storageKey));
  assert.deepEqual(state.materials.filter((m: any) => m.unitId === result.unitIds![1]).map((m: any) => m.storageKey), [files[2].storageKey, files[0].storageKey]);
  assert.equal(state.materials.filter((m: any) => m.unitId === result.unitIds![2]).length, 0);
  assert(state.units.every((u: any) => !('mediaIndexes' in u)));
  await service.batch(actor, input); assert.equal(state.materials.length, 4);
  await assert.rejects(service.batch(actor, { ...input, sharedMediaIndexes: [0] }), /重复提交编号冲突/);
  await assert.rejects(service.batch(actor, { ...input, rows: input.rows.map((r, i) => i === 1 ? { ...r, mediaIndexes: [0] } : r) }), /重复提交编号冲突/);
});
test("invalid and duplicate material assignments cannot create any units", async () => {
  const mediaTokens = [signBatchMedia(actor.id, projectId, mediaFile("PHOTO"))];
  for (const indexes of [[1], [-1], [0, 0], [0.5], [30]]) {
    for (const override of [false, true]) {
      const { service, state } = fixture(); const input = body();
      await assert.rejects(service.batch(actor, { ...input, mediaTokens, ...(override ? { rows: input.rows.map(r => ({ ...r, mediaIndexes: indexes })) } : { sharedMediaIndexes: indexes }) }));
      assert.equal(state.units.length, 0); assert.equal(state.materials.length, 0);
    }
  }
});
