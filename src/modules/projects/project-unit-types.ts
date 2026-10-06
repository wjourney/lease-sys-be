import { number } from "../../common/utils/value";

// Existing units remain usable while old global types are moved into project forms.
// Global names are read only for codes already used by this project, never as new choices.
export async function projectUnitTypes(tx: any, project: any) {
  const configured: any[] = Array.isArray(project.typeConfigs)
    ? project.typeConfigs
    : [];
  const units = await tx.unit.findMany({
    where: { projectId: project.id },
    select: { unitTypeCode: true, area: true, minRent: true, maxRent: true },
  });
  const missing = [...new Set(units.map((u: any) => u.unitTypeCode))].filter(
    (code) => !configured.some((c) => c.code === code),
  );
  const dictionary = missing.length
    ? await tx.systemSetting.findUnique({ where: { key: "unit_types" } })
    : null;
  const bounds = (rows: any[], key: string, max: boolean) =>
    rows.reduce(
      (value, u) =>
        value == null ||
        (max ? number(u[key]).gt(value) : number(u[key]).lt(value))
          ? String(u[key])
          : value,
      undefined,
    );
  return [
    ...configured.map((c) => ({ ...c, name: c.name || c.code })),
    ...missing.map((code) => {
      const rows = units.filter((u: any) => u.unitTypeCode === code);
      return {
        code,
        name:
          (dictionary?.value ?? []).find((d: any) => d.code === code)?.name ||
          code,
        minArea: bounds(rows, "area", false),
        maxArea: bounds(rows, "area", true),
        minRent: bounds(rows, "minRent", false),
        maxRent: bounds(rows, "maxRent", true),
      };
    }),
  ];
}
