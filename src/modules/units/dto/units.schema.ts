import { z } from "zod";
import { money, opt, text, uuid } from "../../../common/validation/fields";
export const UnitsSchema = z.object({
  projectId: uuid,
  unitNo: text.optional(),
  unitTypeCode: text,
  building: opt,
  floor: opt,
  roomNo: text,
  area: money.optional(),
  layout: opt,
  decoration: opt,
  referenceRent: money.optional(),
  minRent: money.optional(),
  maxRent: money.optional(),
  minLeaseMonths: z.number().int().min(1).max(120).optional(),
  commissionNote: opt,
  extra: z.object({
    phase: opt,
    age: opt,
    currentState: opt,
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
