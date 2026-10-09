import { z } from "zod";
import { uuid } from "../../../common/validation/fields";
const mediaIndexes = z.array(z.number().int().min(0).max(29)).max(30).refine(v => new Set(v).size === v.length, "资料索引不能重复");
export const UnitBatchSchema = z.object({
  requestId: uuid,
  projectId: uuid,
  sharedMediaIndexes: mediaIndexes.optional(),
  mediaTokens: z.array(z.string().min(1).max(4000)).max(30).optional(),
  rows: z.array(z.object({
    unitTypeCode: z.string().trim().min(1).max(500),
    mediaIndexes: mediaIndexes.optional(),
    roomNo: z.string().trim().min(1).max(100),
  }).strict()).min(1).max(100),
}).strict();
