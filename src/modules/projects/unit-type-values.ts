import { fail } from "../../common/utils/errors";
import { number } from "../../common/utils/value";
export function validateUnitType(type: any) {
  if (!type || ![type.name, type.building, type.floor, type.layout].every(v => typeof v === "string" && v.trim()) || type.area == null || type.minRent == null || type.maxRent == null || type.referenceRent == null)
    fail("请完善单位类型的名称、期/座、楼层、面积、间隔、价格范围和月租价格");
  if (number(type.area).lte(0) || number(type.minRent).lt(0) || number(type.minRent).gt(type.maxRent) || number(type.referenceRent).lt(type.minRent) || number(type.referenceRent).gt(type.maxRent)) fail("请检查单位类型的面积、价格范围和月租价格");
}
export function unitTypeValues(type: any, extra: any = {}) {
  validateUnitType(type);
  const { currentState, age, ...rest } = extra ?? {};
  return { building: type.building, floor: type.floor, area: type.area, layout: type.layout,
    minRent: type.minRent, maxRent: type.maxRent, referenceRent: type.referenceRent,
    extra: { ...rest, phase: type.building } };
}
