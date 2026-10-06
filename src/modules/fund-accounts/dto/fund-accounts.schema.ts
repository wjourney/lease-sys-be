import { z } from "zod";
import { common, text } from "../../../common/validation/fields";
export const FundAccountsSchema = z.object({
  name: text,
  bankName: text,
  accountIdentifier: text,
  currency: z.enum(["HKD"]).optional(),
  enabled: z.boolean().optional(),
  ...common,
});
export type FundAccountsInput = z.input<typeof FundAccountsSchema>;
