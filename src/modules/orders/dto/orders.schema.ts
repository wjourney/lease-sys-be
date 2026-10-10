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
  projectId: uuid.optional(),
  unitId: uuid.optional(),
  salesCompanyId: uuid.optional(),
  salesUserId: uuid.optional(),
  tenantType: z.enum(["PERSON", "COMPANY"]).optional(),
  tenantName: text,
  registrationNoType: z.enum(["BR", "CR", "HKID", "PASSPORT"]).nullish(),
  tenantRegistrationNo: opt,
  tenantContactName: opt,
  tenantPhone: opt,
  tenantEmail: z.union([z.email(), z.literal("")]).optional(),
  startsOn: date.optional(),
  endsOn: date.optional(),
  monthlyRent: money.optional(),
  depositAmount: money.optional(),
  depositPlan: z.enum(["ONE_ONE", "TWO_ONE", "THREE_ONE", "OTHER"]).nullish(),
  commission: z
    .object({
      mode: z
        .enum(["MONTHLY", "YEARLY", "ONE_TIME", "RECURRING_MONTHLY"])
        .optional(),
      periodStart: date.optional(),
      periodEnd: date.optional(),
      dueOn: date.optional(),
      amount: money.optional(),
      remark: opt,
    })
    .strict()
    .optional(),
  moveInOn: date.nullish(),
  initialPayment: z
    .object({
      paymentState: z.enum(["UNPAID", "PAID"]).optional(),
      paid: z.boolean(),
      rentPaid: z.boolean(),
      depositPaid: z.boolean(),
      rentReceived: money,
      depositReceived: money,
      dueOn: z.iso.date().optional(),
      receivedOn: z.iso.date().optional(),
      fundAccountId: uuid.optional(),
      paymentMethod: z.enum(["BANK", "CASH", "CHEQUE"]).optional(),
      bankReference: opt,
    })
    .strict()
    .optional(),
  paymentIntervalMonths: z.number().int().min(1).max(12).optional(),
  rentDueDay: z.number().int().min(1).max(31).optional(),
  billLeadDays: z.number().int().min(0).max(60).optional(),
  firstPeriodProration: z.boolean().optional(),
  lastPeriodProration: z.boolean().optional(),
  ...common,
});
export type OrdersInput = z.input<typeof OrdersSchema>;
