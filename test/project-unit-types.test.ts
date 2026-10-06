import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectsService } from "../src/modules/projects/projects.service";
import { UnitsService } from "../src/modules/units/units.service";
import { SettingsService } from "../src/modules/settings/settings.service";
import { projectUnitTypes } from "../src/modules/projects/project-unit-types";
const type = {
  code: "LARGE",
  name: "大单位",
  minArea: "40",
  maxArea: "80",
  minRent: "10000",
  maxRent: "20000",
};
const project: any = { id: "project", typeConfigs: [type] };
const tx: any = {
  $queryRawUnsafe: async () => [],
  unit: { findMany: async () => [], count: async () => 0 },
  systemSetting: {
    findUnique: async () => {
      throw new Error("New configuration must not consult global types");
    },
  },
};
const access: any = { get: async () => project };
const projects: any = new ProjectsService(tx, access, {} as any);
const units: any = new UnitsService(tx, access, {} as any);
test("project types are independent and accept custom codes without global registration", async () => {
  await projects.validate(
    {},
    { typeConfigs: [type, { ...type, code: "CUSTOM", name: "花园单位" }] },
    tx,
  );
  assert.deepEqual(await projectUnitTypes(tx, project), [type]);
});
test("project type validation rejects missing fields, invalid bounds and duplicate names", async () => {
  for (const configs of [
    [],
    [{ ...type, name: "" }],
    [{ ...type, maxArea: "20" }],
    [{ ...type, maxRent: "1" }],
    [{ ...type, minArea: "0" }],
    [{ ...type, minRent: undefined }],
    [type, { ...type, code: "OTHER" }],
  ])
    await assert.rejects(projects.validate({}, { typeConfigs: configs }, tx));
  await assert.rejects(projects.validate({}, {}, tx));
});
test("used types cannot be removed from a project", async () => {
  await assert.rejects(
    projects.validate(
      {},
      { typeConfigs: [type] },
      { ...tx, unit: { count: async () => 1 } },
      project,
    ),
  );
});
test("unit validation accepts only its own project types", async () => {
  const data = {
    projectId: "project",
    unitTypeCode: "LARGE",
    area: "50",
    minRent: "10000",
    maxRent: "20000",
    referenceRent: "15000",
  };
  await units.validate({}, data, tx);
  await assert.rejects(
    units.validate({}, { ...data, unitTypeCode: "ANOTHER_PROJECT_TYPE" }, tx),
  );
});
test("legacy fallback includes only types already used in this project and derives ranges", async () => {
  const legacy = {
    unit: {
      findMany: async ({ where }: any) => {
        assert.equal(where.projectId, "project");
        return [
          {
            unitTypeCode: "OLD",
            area: "35",
            minRent: "9000",
            maxRent: "11000",
          },
          {
            unitTypeCode: "OLD",
            area: "45",
            minRent: "10000",
            maxRent: "13000",
          },
        ];
      },
    },
    systemSetting: {
      findUnique: async () => ({
        value: [
          { code: "OLD", name: "原有单位" },
          { code: "UNUSED", name: "无关类型" },
        ],
      }),
    },
  };
  const result = await projectUnitTypes(legacy, {
    id: "project",
    typeConfigs: [],
  });
  assert.deepEqual(result, [
    {
      code: "OLD",
      name: "原有单位",
      minArea: "35",
      maxArea: "45",
      minRent: "9000",
      maxRent: "13000",
    },
  ]);
});
test("global unit type editing is disabled", async () => {
  const settings: any = new SettingsService(tx, access);
  await assert.rejects(
    settings.validate({}, { key: "unit_types", value: [] }, tx),
  );
});
