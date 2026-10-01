import { z } from "zod";
import { opt, text, uuid } from "../../../common/validation/fields";
export const MaterialsSchema = z.object({
  projectId: uuid.optional(),
  unitId: uuid.optional(),
  orderId: uuid.optional(),
  incomeId: uuid.optional(),
  expenseId: uuid.optional(),
  invoiceId: uuid.optional(),
  salesCompanyId: uuid.optional(),
  userId: uuid.optional(),
  category: z.enum([
    "OFFICIAL",
    "MARKETING",
    "GUIDE",
    "CONTRACT",
    "TEMPLATE",
    "PHOTO",
    "VIDEO",
    "PROJECT_FILE",
    "LOGO",
    "VOUCHER",
    "INVOICE",
    "OTHER",
  ]),
  visibility: z.enum(["SHARED", "INTERNAL"]).optional(),
  title: text,
  description: opt,
  body: z.string().max(50000).optional(),
  sourceUrl: z
    .url()
    .refine(
      (v) => ["http:", "https:"].includes(new URL(v).protocol),
      "仅支持 HTTP 链接",
    )
    .optional(),
  sortOrder: z.number().int().optional(),
});
export type MaterialsInput = z.input<typeof MaterialsSchema>;
