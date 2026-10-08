import { z } from "zod";
import { money, uuid } from "../../../common/validation/fields";
export const UnitBatchSchema = z.object({
  requestId: uuid,
  projectId: uuid,
  rows: z.array(z.object({
    unitTypeCode: z.string().trim().min(1).max(500),
    roomNo: z.string().trim().min(1).max(100),
    referenceRent: money.optional(),
  }).strict()).min(1).max(100),
}).strict();
