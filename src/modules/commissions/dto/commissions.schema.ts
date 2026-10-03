import { z } from "zod";
import { common, date, money, uuid } from "../../../common/validation/fields";
export const CommissionsSchema = z.object({
  orderId: uuid,
  mode: z.enum(["MONTHLY", "YEARLY", "ONE_TIME", "RECURRING_MONTHLY"]),
  periodStart: date,
  periodEnd: date,
  dueOn: date,
  amount: money.nullable().optional(),
  ...common,
});
export type CommissionsInput = z.input<typeof CommissionsSchema>;
