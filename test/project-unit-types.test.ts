import "reflect-metadata";
import { test } from "node:test";
import assert from "node:assert/strict";
import { ProjectsService } from "../src/modules/projects/projects.service";
import { UnitsService } from "../src/modules/units/units.service";
import { SettingsService } from "../src/modules/settings/settings.service";
import { projectUnitTypes } from "../src/modules/projects/project-unit-types";
import { ProjectsSchema } from "../src/modules/projects/dto/projects.schema";
const type = {
  code: "LARGE",
  name: "大单位",
  building: "A座", floor: "12", area: "48", layout: "两房",
  minRent: "10000",
  maxRent: "20000", referenceRent: "15000",
};
const project: any = { id: "project", typeConfigs: [type] };
const tx: any = {
  $queryRawUnsafe: async () => [],
  unit: { findMany: async () => [], count: async () => 0, findFirst: async () => null },
  systemSetting: {
    findUnique: async () => {
      throw new Error("New configuration must not consult global types");
    },
  },
};
const access: any = { get: async () => project };
const projects: any = new ProjectsService(tx, access, {} as any);
const units: any = new UnitsService(tx, access, {} as any);
test("project metadata is optional and unit types no longer require building age", () => {
  const parsed = ProjectsSchema.parse({
    name: "海湾项目", region: "港岛", address: "海湾路", typeConfigs: [type],
    extra: { floorCount: 28, completionYear: 2023, ownership: "单一业权", parking: "地下停车场", mtrStation: "太古站" },
  });
  assert.equal(parsed.extra?.completionYear, 2023);
  assert.equal(parsed.typeConfigs?.[0].name, "大单位");
  assert.equal(ProjectsSchema.safeParse({ name: "海湾项目", region: "港岛", address: "海湾路", typeConfigs: [type] }).success, true);
  assert.equal(ProjectsSchema.safeParse({ name: "海湾项目", region: "港岛", address: "海湾路", extra: { completionYear: 1780 } }).success, false);
});
test("project images can select a photo as the first Logo without duplicating it", async () => {
  const logoId = "00000000-0000-4000-8000-000000000001";
  const photoId = "00000000-0000-4000-8000-000000000002";
  const images = [
    { id: logoId, category: "LOGO", sortOrder: 0, revision: 1, operationLogs: [] },
    { id: photoId, category: "PHOTO", sortOrder: 0, revision: 1, operationLogs: [] },
  ];
  const changed: Array<{ id: string; sortOrder: number }> = [];
  const database: any = {
    $transaction: async (callback: (tx: any) => Promise<any>) => callback({
      $queryRaw: async () => [],
      material: {
        findMany: async ({ where }: any) => {
          assert.deepEqual(where.category.in, ["PHOTO", "LOGO"]);
          return images;
        },
        updateMany: async ({ where, data }: any) => {
          changed.push({ id: where.id, sortOrder: data.sortOrder });
          return { count: 1 };
        },
        findUnique: async () => ({}),
      },
    }),
  };
  const service: any = new ProjectsService(database, { allow: () => {}, get: async () => project } as any, {} as any);
  await service.orderImages({ id: "admin", name: "管理员" }, "project", { ids: [photoId, logoId] });
  assert.deepEqual(changed, [{ id: logoId, sortOrder: 1 }]);
  await assert.rejects(service.orderImages({ id: "admin", name: "管理员" }, "project", { ids: [photoId] }));
});
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
    [{ ...type, area: "0" }],
    [{ ...type, maxRent: "1" }],
    [{ ...type, floor: "" }],
    [{ ...type, minRent: undefined }],
    [{ ...type, referenceRent: undefined }],
    [{ ...type, referenceRent: "999" }],
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
    roomNo: "1201", area: "999",
    minRent: "10000",
    maxRent: "20000", referenceRent: "15000",
    referenceRent: "15000",
  };
  await units.validate({}, data, tx);
  assert.equal(data.area, "48");
  assert.equal((data as any).floor, "12");
  const forged = { ...data, referenceRent: "999" };
  await units.validate({}, forged, tx);
  assert.equal(forged.referenceRent, "15000");
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
