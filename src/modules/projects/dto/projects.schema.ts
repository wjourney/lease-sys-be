import { z } from "zod";
import { money, opt, text } from "../../../common/validation/fields";
const ProjectExtraSchema = z
  .object({
    landLeaseEndDate: z.iso.date().optional(),
    salesStatus: z.enum(["现售", "待售", "售罄"]).optional(),
    buildingStatus: z.enum(["现楼", "楼花", "建设中"]).optional(),
    usage: z.enum(["住宅", "商业", "办公", "综合"]).optional(),
    areaRange: opt,
    unitInterval: opt,
    managementFee: opt,
    lawyerFirm: opt,
    nearbySchools: opt,
    website: z.url().optional(),
    salesOffice: opt,
  })
  .passthrough();

export const ProjectsSchema = z.object({
  name: text,
  nameEn: opt,
  region: text,
  address: text,
  propertyName: opt,
  developer: opt,
  longitude: z.number().min(-180).max(180).nullable().optional(),
  latitude: z.number().min(-90).max(90).nullable().optional(),
  description: opt,
  facilities: z.array(z.string()).optional(),
  extra: ProjectExtraSchema.optional(),
  salesCanViewExactRent: z.boolean().optional(),
  typeConfigs: z
    .array(
      z.object({
        code: text,
        name: text,
        building: text,
        floor: text,
        area: money,
        layout: text,
        age: z.number().int().min(0).max(999),
        minRent: money,
        maxRent: money,
        referenceRent: money,
      }),
    )
    .optional(),
  lessorProfile: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});
export type ProjectsInput = z.input<typeof ProjectsSchema>;
