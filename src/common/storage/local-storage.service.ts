import { Injectable } from "@nestjs/common";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
@Injectable()
export class LocalStorageService {
  root() {
    return resolve(process.env.UPLOAD_DIR || "uploads");
  }
  async save(buffer: Buffer) {
    await mkdir(this.root(), { recursive: true });
    const key = randomUUID();
    await writeFile(resolve(this.root(), key), buffer, { flag: "wx" });
    return {
      storageKey: key,
      sizeBytes: buffer.length,
      checksum: createHash("sha256").update(buffer).digest("hex"),
    };
  }
}
