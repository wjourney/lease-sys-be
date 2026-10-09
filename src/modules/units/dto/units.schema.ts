import { z } from "zod";
import { opt, text, uuid } from "../../../common/validation/fields";
export const UnitsSchema = z.object({
  projectId: uuid,
  unitTypeCode: text,
  roomNo: text,
  decoration: opt,
  minLeaseMonths: z.number().int().min(1).max(120).optional(),
  commissionNote: opt,
  extra: z.object({
    usage: opt,
    askingRent: opt,
    discountOne: opt,
    discountTwo: opt,
    rentCycle: opt,
    salesOfficeNote: opt,
    signingGuideNote: opt,
  }).optional(),
  enabled: z.boolean().optional(),
});
export type UnitsInput = z.input<typeof UnitsSchema>;
