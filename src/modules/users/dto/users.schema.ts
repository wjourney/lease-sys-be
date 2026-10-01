import { z } from "zod";
import { roles } from "../../../common/auth/actor";
import { date, opt, text, uuid } from "../../../common/validation/fields";
export const UsersSchema = z.object({
  username: z.string().regex(/^[a-zA-Z0-9_.-]{3,50}$/),
  password: z.string().min(10).max(128),
  name: text,
  nameEn: opt,
  phone: text,
  email: opt,
  role: z.enum(roles),
  salesCompanyId: uuid.nullable().optional(),
  branchCode: opt,
  positionCode: opt,
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
  expiresAt: date.optional(),
});
export type UsersInput = z.input<typeof UsersSchema>;
