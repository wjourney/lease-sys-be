import { createHmac } from "node:crypto";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { secret } from "../auth/jwt.config";
import { fail } from "../../common/utils/errors";
import { uuid } from "../../common/validation/fields";
import type { StoredFile } from "../../common/storage/storage.service";

export const BatchMediaUploadSchema = z.object({
  projectId: uuid,
  category: z.enum(["PHOTO", "VIDEO", "PROJECT_FILE"]),
}).strict();
export type BatchMediaFile = StoredFile & {
  category: "PHOTO" | "VIDEO" | "PROJECT_FILE";
  originalName: string;
  mimeType: string;
};
// Separate signing key and audience: a file ticket can never authenticate a session.
const key = () => createHmac("sha256", secret()).update("unit-batch-media").digest();
export function signBatchMedia(actorId: string, projectId: string, file: BatchMediaFile) {
  return jwt.sign({ actorId, projectId, file }, key(), {
    algorithm: "HS256", audience: "unit-batch-media", expiresIn: "23h",
  });
}
export function readBatchMedia(token: string, actorId: string, projectId: string): BatchMediaFile {
  try {
    const payload = jwt.verify(token, key(), { algorithms: ["HS256"], audience: "unit-batch-media" }) as any;
    if (payload.actorId !== actorId || payload.projectId !== projectId || !payload.file) throw new Error();
    return payload.file;
  } catch { return fail("批量资料已过期或归属不匹配，请重新选择并上传文件"); }
}
