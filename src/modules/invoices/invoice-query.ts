import { z } from "zod";
import { date } from "../../common/validation/fields";

export const InvoiceQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    status: z.enum(["DRAFT", "ACTIVE", "VOID", "ALL"]).optional(),
    emailStatus: z
      .enum(["IDLE", "PENDING", "SENDING", "SENT", "UNKNOWN", "FAILED"])
      .optional(),
    incomeId: z.string().uuid().optional(),
    billId: z.string().uuid().optional(),
    from: date.optional(),
    to: date.optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sortBy: z
      .enum(["createdAt", "invoiceNo", "issuedOn", "amount"])
      .default("createdAt"),
    sort: z.enum(["asc", "desc"]).default("desc"),
  })
  .refine(
    (v) => !v.from || !v.to || v.from <= v.to,
    "结束日期不能早于开始日期",
  );

export const InvoiceDraftInput = z
  .object({
    billId: z.string().uuid(),
    issuedOn: date,
    dueOn: date,
    remark: z.string().max(3000).optional(),
  })
  .strict();
