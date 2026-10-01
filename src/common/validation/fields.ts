import { z } from "zod";
export const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式为 YYYY-MM-DD")
  .refine(
    (v) =>
      !Number.isNaN(Date.parse(v)) &&
      new Date(v).toISOString().slice(0, 10) === v,
    "无效日期",
  )
  .transform((v) => new Date(v + "T00:00:00.000Z"));
export const money = z
  .union([z.string(), z.number()])
  .transform(String)
  .refine((v) => /^\d{1,12}(\.\d{1,2})?$/.test(v), "金额最多两位小数");
export const text = z.string().trim().min(1).max(500);
export const opt = z.string().max(3000).optional();
export const uuid = z.string().uuid();
export const common = { remark: opt };
