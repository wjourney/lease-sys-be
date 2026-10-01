import { z } from "zod";
import { common, opt, text } from "../../../common/validation/fields";
export const FundAccountsSchema = z.object({
  name: text,
  bankName: opt,
  accountIdentifier: opt,
  currency: z.enum(["HKD"]).optional(),
  enabled: z.boolean().optional(),
  ...common,
});
export type FundAccountsInput = z.input<typeof FundAccountsSchema>;
