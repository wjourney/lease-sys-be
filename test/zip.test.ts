import assert from "node:assert/strict";
import { test } from "node:test";
import { execFileSync } from "node:child_process";
import { createZip } from "../src/common/storage/zip";
test("ZIP preserves Chinese filenames, bytes and CRC in a standard reader", () => {
  const data = createZip([
    { name: "租赁合同.pdf", data: Buffer.from("%PDF-test") },
    { name: "下载结果.txt", data: Buffer.from("成功") },
  ]);
  const result = execFileSync(
    "python3",
    [
      "-c",
      "import sys,io,zipfile,json; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.testzip() is None; print(json.dumps({n:z.read(n).decode() for n in z.namelist()},ensure_ascii=False))",
    ],
    { input: data },
  );
  assert.deepEqual(JSON.parse(result.toString()), {
    "租赁合同.pdf": "%PDF-test",
    "下载结果.txt": "成功",
  });
});
