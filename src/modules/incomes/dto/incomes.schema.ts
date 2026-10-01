import { z } from "zod";
import {
  common,
  date,
  money,
  opt,
  text,
  uuid,
} from "../../../common/validation/fields";
export const IncomesSchema = z.object({
  orderId: uuid.nullable().optional(),
  projectId: uuid.nullable().optional(),
  unitId: uuid.nullable().optional(),
  feeType: z.enum(["RENT", "DEPOSIT", "OTHER"]),
  amount: money,
  dueOn: date,
  payerName: text,
  payerEmail: opt,
  recurrenceRule: z
    .object({ frequency: z.enum(["ONCE", "MONTHLY"]) })
    .optional(),
  ...common,
});
export type IncomesInput = z.input<typeof IncomesSchema>;
