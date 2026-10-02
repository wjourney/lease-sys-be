import { z } from "zod";
import {
  common,
  date,
  money,
  opt,
  text,
  uuid,
} from "../../../common/validation/fields";
export const OrdersSchema = z.object({
  unitId: uuid,
  salesUserId: uuid,
  tenantType: z.enum(["PERSON", "COMPANY"]),
  tenantName: text,
  registrationNoType: z.enum(["BR", "CR", "HKID", "PASSPORT"]).optional(),
  tenantRegistrationNo: opt,
  tenantContactName: opt,
  tenantPhone: opt,
  tenantEmail: z.union([z.email(), z.literal("")]).optional(),
  startsOn: date,
  endsOn: date,
  monthlyRent: money,
  depositAmount: money,
  depositPlan: z.enum(["ONE_ONE", "TWO_ONE", "THREE_ONE", "OTHER"]).optional(),
  moveInOn: date.optional(),
  initialPayment: z
    .object({
      paid: z.boolean(),
      rentPaid: z.boolean(),
      depositPaid: z.boolean(),
      rentReceived: money,
      depositReceived: money,
      dueOn: z.iso.date().optional(),
    })
    .strict()
    .optional(),
  paymentIntervalMonths: z.number().int().min(1).max(12).optional(),
  rentDueDay: z.number().int().min(1).max(28).optional(),
  billLeadDays: z.number().int().min(0).max(60).optional(),
  firstPeriodProration: z.boolean().optional(),
  lastPeriodProration: z.boolean().optional(),
  ...common,
});
export type OrdersInput = z.input<typeof OrdersSchema>;
