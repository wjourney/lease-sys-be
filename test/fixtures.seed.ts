import "dotenv/config";
import { PrismaService as Db } from "../src/database/prisma.service";
import { AccessService as Access } from "../src/common/auth/access.service";
import { hashPassword } from "../src/common/auth/password";
import { insert } from "../src/common/database/record-mutations";
import { OrderLifecycleService } from "../src/modules/orders/order-lifecycle.service";
import { RentBillingService } from "../src/modules/incomes/rent-billing.service";
const db = new Db();
async function main() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || new URL(databaseUrl).pathname !== "/lease_test")
    throw new Error("Test fixtures can only be loaded into lease_test");
  if (await db.user.count()) {
    console.log("Seed skipped: database already contains users");
    return;
  }
  const password = process.env.SEED_PASSWORD;
  if (!password || password.length < 10)
    throw new Error("Set SEED_PASSWORD (10+ characters)");
  const hash = hashPassword(password);
  const admin = await db.user.create({
    data: {
      username: "admin",
      name: "陈嘉文",
      role: "SUPER_ADMIN",
      passwordHash: hash,
    },
  });
  const a = { ...admin };
  const company = await insert(
    db,
    "sales-companies",
    {
      companyNo: "C202609001",
      name: "港盛置业有限公司",
      nameEn: "Harbour Property Limited",
      contactName: "李敏",
      phone: "+852 2345 6789",
      email: "contact@example.com",
      address: "香港九龙尖沙咀广东道",
      serviceStartsOn: new Date("2026-01-01"),
      serviceEndsOn: new Date("2030-12-31"),
      branches: [{ code: "kowloon", name: "九龙分行", enabled: true }],
      positions: [{ code: "agent", name: "物业顾问", enabled: true }],
    },
    a,
  );
  const company2 = await insert(
    db,
    "sales-companies",
    {
      companyNo: "C202609002",
      name: "远景地产有限公司",
      contactName: "周先生",
      serviceEndsOn: new Date("2030-12-31"),
    },
    a,
  );
  for (const [username, name, role, companyId] of [
    ["operations", "林晓彤", "OPERATIONS", null],
    ["finance", "王子涵", "FINANCE", null],
    ["company", "李敏", "SALES_COMPANY_ADMIN", company.id],
    ["sales", "陈浩然", "SALES", company.id],
    ["sales.other", "周宇", "SALES", company2.id],
  ])
    await insert(
      db,
      "users",
      {
        username,
        name,
        role,
        salesCompanyId: companyId,
        passwordHash: hash,
        phone: "+852 9123 4567",
        email: username + "@example.com",
      },
      a,
    );
  const settings = await insert(
    db,
    "settings",
    {
      key: "unit_types",
      value: [
        { code: "apartment", name: "公寓", sortOrder: 1, enabled: true },
        { code: "studio", name: "开放式单位", sortOrder: 2, enabled: true },
        { code: "office", name: "办公室", sortOrder: 3, enabled: true },
      ],
    },
    a,
  );
  await insert(
    db,
    "settings",
    {
      key: "business_defaults",
      value: {
        companyName: "SUPREME BAY",
        currency: "HKD",
        timezone: "Asia/Hong_Kong",
      },
    },
    a,
  );
  await insert(
    db,
    "fund-accounts",
    {
      name: "公司港币账户",
      bankName: "汇丰银行",
      accountIdentifier: "123-456789-001",
      currency: "HKD",
    },
    a,
  );
  const projects = [];
  for (const [i, name, region, address] of [
    [0, "海棠里", "九龙", "香港九龙城启德承丰道 18 号"],
    [1, "云栖苑", "新界", "香港沙田安睦街 8 号"],
    [2, "江语城", "港岛", "香港鲗鱼涌海湾街 26 号"],
  ] as any[]) {
    const p = await insert(
      db,
      "projects",
      {
        code: "P20260900" + (i + 1),
        name: name + "项目",
        nameEn: ["HARBOUR RESIDENCE", "CLOUD GARDEN", "RIVERSIDE"][i],
        region,
        address,
        developer: "示例发展有限公司",
        description:
          "交通便利，配备公共休息区与全天候安保服务。提供灵活租期，满足多样化居住需求。",
        completionDate: new Date("2023-01-01"),
        facilities: ["会所", "健身室", "公共休息区", "24 小时安保"],
        salesCanViewExactRent: i === 1,
      },
      a,
    );
    projects.push(p);
    for (let n = 1; n <= 8; n++)
      await insert(
        db,
        "units",
        {
          projectId: p.id,
          unitNo: (n < 5 ? "A" : "B") + "座 " + (1200 + n),
          unitTypeCode: n % 3 ? "apartment" : "studio",
          building: n < 5 ? "A座" : "B座",
          floor: "12",
          roomNo: String(n).padStart(2, "0"),
          area: 28 + n * 3,
          layout: n % 3 ? "1室1厅" : "开放式",
          decoration: "精装修",
          referenceRent: 5000 + n * 400,
          minRent: 4500 + n * 400,
          maxRent: 6000 + n * 400,
          minLeaseMonths: 1,
          commissionNote: "佣金由财务按结算期录入",
        },
        a,
      );
    await insert(
      db,
      "materials",
      {
        projectId: p.id,
        category: "GUIDE",
        title: "入住与交还指引",
        body: "入住前请核实身份信息、租赁日期和付款记录。交还时请整理随附物品并由运营登记交还结果。",
      },
      a,
    );
    await insert(
      db,
      "materials",
      {
        projectId: p.id,
        category: "TEMPLATE",
        title: "租赁资料模板",
        body: "项目名称及房产信息以订单快照为准。租期、月租、押金与付款安排见上方资料。双方签署内容由项目正式模板补充。",
        visibility: "INTERNAL",
      },
      a,
    );
  }
  const sales = await db.user.findUniqueOrThrow({
    where: { username: "sales" },
  });
  const other = await db.user.findUniqueOrThrow({
    where: { username: "sales.other" },
  });
  const units = await db.unit.findMany({
    where: { projectId: projects[0].id },
    orderBy: { unitNo: "asc" },
  });
  const b = new OrderLifecycleService(
    db,
    new Access(db),
    new RentBillingService(db, new Access(db)),
  );
  for (let n = 0; n < 3; n++) {
    const o = await b.createOrder(a, {
      unitId: units[n].id,
      salesUserId: n === 2 ? other.id : sales.id,
      tenantType: n === 1 ? "COMPANY" : "PERSON",
      tenantName: ["陈女士", "景和科技有限公司", "林先生"][n],
      tenantPhone: "+852 9234 5678",
      tenantEmail: "tenant@example.com",
      startsOn: "2026-10-01",
      endsOn: "2027-09-30",
      monthlyRent: String(5400 + n * 400),
      depositAmount: String((5400 + n * 400) * 2),
      paymentIntervalMonths: 1,
      rentDueDay: 1,
      billLeadDays: 7,
      firstPeriodProration: true,
      lastPeriodProration: true,
    });
    await insert(
      db,
      "commissions",
      {
        commissionNo: "CM20261000" + (n + 1),
        orderId: o.id,
        salesCompanyId: o.salesCompanyId,
        salesUserId: o.salesUserId,
        mode: "MONTHLY",
        periodStart: new Date("2026-10-01"),
        periodEnd: new Date("2026-10-31"),
        dueOn: new Date("2026-11-05"),
        amount: n === 1 ? null : 1200,
      },
      a,
    );
  }
  await insert(
    db,
    "expenses",
    {
      expenseNo: "E202609001",
      projectId: projects[0].id,
      feeType: "MAINTENANCE",
      amount: 800,
      payeeName: "景诚维修服务",
      dueOn: new Date("2026-10-05"),
      remark: "单位例行维护",
    },
    a,
  );
  console.log(
    "Test fixtures ready. Accounts: admin / operations / finance / company / sales / sales.other. Password: configured SEED_PASSWORD",
  );
}
main().finally(() => db.$disconnect());
