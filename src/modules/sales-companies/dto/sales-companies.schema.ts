import { z } from "zod";
import { date, opt, text } from "../../../common/validation/fields";
export const SalesCompaniesSchema = z.object({
  name: text,
  nameEn: opt,
  contactName: opt,
  phone: opt,
  email: z.union([z.email(), z.literal("")]).optional(),
  address: opt,
  serviceArea: opt,
  registrationNo: opt,
  payoutBankName: z.string().trim().max(191).optional(),
  payoutAccountName: z.string().trim().max(191).optional(),
  payoutAccountNo: z.string().trim().max(191).optional(),
  serviceStartsOn: date.optional(),
  serviceEndsOn: date.optional(),
  registrationExpiresOn: date.optional(),
  branches: z
    .array(z.object({ code: text, name: text, enabled: z.boolean() }))
    .optional(),
  positions: z
    .array(z.object({ code: text, name: text, enabled: z.boolean() }))
    .optional(),
});
export type SalesCompaniesInput = z.input<typeof SalesCompaniesSchema>;
