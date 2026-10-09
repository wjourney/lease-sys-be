import { test } from "node:test";
import assert from "node:assert/strict";
import {
  CONTRACT_DOCUMENT_VERSION,
  contractHtml,
} from "../src/modules/orders/contract-document";

const order = {
  orderNo: "R202610030001",
  tenantType: "COMPANY",
  tenantName: "示例科技有限公司",
  tenantRegistrationNo: "BR-123456",
  tenantContactName: "张女士",
  tenantPhone: "13800000000",
  tenantEmail: "tenant@example.com",
  startsOn: new Date("2026-11-01T00:00:00.000Z"),
  endsOn: new Date("2027-10-31T00:00:00.000Z"),
  monthlyRent: "15000.00",
  depositAmount: "30000.00",
  paymentIntervalMonths: 1,
  rentDueDay: 5,
  firstPeriodProration: true,
  lastPeriodProration: false,
  depositPlan: "TWO_ONE",
  currency: "HKD",
};
const project = {
  name: "示例花园",
  address: "香港某区示例路 1 号",
  lessorProfile: { name: "示例业主", phone: "12345678" },
};
const unit = { unitNo: "A座 201" };

test("contract has detailed terms, key values and signature sections", () => {
  const html = contractHtml(order, project, unit);
  assert.equal(CONTRACT_DOCUMENT_VERSION, 3);
  assert.ok(!html.includes("预计入住"));
  assert.ok(!html.includes("办理入住日期"));
  for (const text of [
    "示例业主",
    "示例科技有限公司",
    "2026-11-01",
    "HKD 15,000.00",
    "HKD 30,000.00",
    "按实际天数折算",
    "按整月计算",
    "押二付一",
    "物业使用、费用与维修",
    "物业交接清单",
    "出租方（甲方）签署",
  ])
    assert.ok(html.includes(text), text);
});

test("project terms take precedence and all supplied text is escaped", () => {
  const html = contractHtml(
    {
      ...order,
      tenantName: "<script>alert(1)</script>",
      remark: "<b>备注</b>",
    },
    project,
    unit,
    "项目专属条款 <img src=x>",
  );
  assert.ok(html.includes("项目专属条款 &lt;img src=x&gt;"));
  assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  assert.ok(html.includes("&lt;b&gt;备注&lt;/b&gt;"));
  assert.ok(!html.includes("物业使用、费用与维修"));
});
