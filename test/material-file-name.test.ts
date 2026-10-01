import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeUploadName } from "../src/modules/materials/file-name";

test("multipart filenames decode UTF-8 without changing valid existing names", () => {
  const name = "租赁资料.pdf";
  assert.equal(normalizeUploadName(Buffer.from(name).toString("latin1")), name);
  assert.equal(normalizeUploadName(name), name);
  assert.equal(normalizeUploadName("original.pdf"), "original.pdf");
  assert.equal(normalizeUploadName("café.pdf"), "café.pdf");
});
