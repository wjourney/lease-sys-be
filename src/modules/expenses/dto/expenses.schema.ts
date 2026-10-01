import { z } from "zod";
import {
  common,
  date,
  money,
  text,
  uuid,
} from "../../../common/validation/fields";
export const ExpensesSchema = z.object({
  orderId: uuid.nullable().optional(),
  projectId: uuid.nullable().optional(),
  unitId: uuid.nullable().optional(),
  feeType: z.enum(["MAINTENANCE", "MANAGEMENT", "OTHER"]),
  amount: money,
  payeeName: text,
  dueOn: date,
  ...common,
});
export type ExpensesInput = z.input<typeof ExpensesSchema>;
