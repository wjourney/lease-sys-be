import { z } from "zod";
export const SettingsSchema = z.object({
  key: z.enum(["unit_types", "business_defaults"]),
  value: z.unknown(),
});
export type SettingsInput = z.input<typeof SettingsSchema>;
