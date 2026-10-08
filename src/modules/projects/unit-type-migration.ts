import { createHash } from "node:crypto";
// Plan only: legacy units with different attributes must never be collapsed into one template.
export function planUnitTypes(project: any, units: any[]) {
  const configured: any[] = Array.isArray(project.typeConfigs) ? project.typeConfigs : [];
  const codes = [...new Set([...configured.map(c => c.code), ...units.map(u => u.unitTypeCode)])];
  const types: any[] = [];
  const assignments: { id: string; code: string }[] = [];
  const incomplete: string[] = [];
  for (const code of codes) {
    const original = configured.find(c => c.code === code) ?? { code, name: code };
    if (original.migratedFromUnits || original.area != null && original.building && original.floor && original.layout && original.age != null) { types.push(original); if (!original.building || !original.floor || !original.layout || original.age == null || original.referenceRent == null) incomplete.push(code); continue; }
    const related = units.filter(u => u.unitTypeCode === code);
    if (!related.length) { types.push({ ...original, area: original.area ?? (original.minArea === original.maxArea ? original.minArea : undefined) }); incomplete.push(code); continue; }
    const groups = new Map<string, { values: any; ids: string[] }>();
    for (const u of related) {
      const values = { building: u.building || u.extra?.phase || "", floor: u.floor || "", area: String(u.area), layout: u.layout || "", age: u.extra?.age != null && /^\d+$/.test(String(u.extra.age)) ? Number(u.extra.age) : undefined, minRent: String(u.minRent), maxRent: String(u.maxRent), referenceRent: u.referenceRent == null ? undefined : String(u.referenceRent) };
      const signature = JSON.stringify(values);
      const group = groups.get(signature) ?? { values, ids: [] };
      group.ids.push(u.id); groups.set(signature, group);
    }
    let index = 0;
    for (const [signature, group] of groups) {
      const newCode = `legacy-${createHash("sha256").update(`${code}:${signature}`).digest("hex").slice(0, 20)}`;
      const v = group.values;
      types.push({ code: newCode, migratedFromUnits: true, name: `${original.name || code} · ${v.building || "期座待补"}/${v.floor || "楼层待补"} · ${++index}`, ...v });
      for (const id of group.ids) assignments.push({ id, code: newCode });
      if (!v.building || !v.floor || !v.layout || v.age == null || v.referenceRent == null) incomplete.push(newCode);
    }
  }
  return { types, assignments, incomplete };
}
