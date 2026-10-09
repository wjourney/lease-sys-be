const esc = (v: unknown) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const shown = (v: unknown, fallback = "签署前填写") =>
  v === null || v === undefined || String(v).trim() === ""
    ? fallback
    : String(v);
const date = (v: Date | string | null | undefined) =>
  v ? new Date(v).toISOString().slice(0, 10) : "签署前填写";
const money = (v: unknown, currency: string) =>
  `${currency} ${Number(v ?? 0).toLocaleString("en-HK", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const row = (label: string, v: unknown) =>
  `<div class="field"><span>${esc(label)}</span><b>${esc(shown(v))}</b></div>`;
const clause = (n: number, title: string, lines: string[]) =>
  `<section class="clause"><h3>${n}. ${esc(title)}</h3>${lines.map((line) => `<p>${esc(line)}</p>`).join("")}</section>`;
function profileValue(profile: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    if (typeof profile[key] === "string" && String(profile[key]).trim())
      return String(profile[key]).trim();
  }
}

export const CONTRACT_DOCUMENT_VERSION = 3;

export function contractHtml(
  order: any,
  project: any,
  unit: any,
  templateBody?: string | null,
) {
  const currency = order.currency || "HKD";
  const profile =
    project?.lessorProfile &&
    typeof project.lessorProfile === "object" &&
    !Array.isArray(project.lessorProfile)
      ? (project.lessorProfile as Record<string, unknown>)
      : {};
  const lessorName = profileValue(profile, [
    "name",
    "companyName",
    "landlordName",
    "出租方名称",
  ]);
  const lessorNumber = profileValue(profile, [
    "registrationNo",
    "companyNo",
    "identityNo",
    "证件号码",
  ]);
  const lessorContact = profileValue(profile, [
    "contactName",
    "contact",
    "联系人",
  ]);
  const lessorPhone = profileValue(profile, ["phone", "contactPhone", "电话"]);
  const address = [project?.address, unit?.unitNo].filter(Boolean).join(" · ");
  const interval = Number(order.paymentIntervalMonths) || 1;
  const rent = money(order.monthlyRent, currency);
  const deposit = money(order.depositAmount, currency);
  const plan =
    (
      {
        ONE_ONE: "押一付一",
        TWO_ONE: "押二付一",
        THREE_ONE: "押三付一",
        OTHER: "其他（签署前确认）",
      } as Record<string, string>
    )[order.depositPlan] || "签署前确认";
  const firstProration = order.firstPeriodProration
    ? "按实际天数折算"
    : "按整月计算";
  const lastProration = order.lastPeriodProration
    ? "按实际天数折算"
    : "按整月计算";
  const defaultClauses = [
    clause(1, "租赁物业与用途", [
      `甲方同意将本合同所列物业出租予乙方。物业位于${shown(address)}；实际交付范围、附属设施及钥匙数量，以双方签署的交接清单为准。`,
      "物业用途、可否分租或转租，以及装修或改动的条件，由双方在签署前确认。",
    ]),
    clause(2, "租期与交付", [
      `租期自 ${date(order.startsOn)} 起至 ${date(order.endsOn)} 止。具体交付安排以双方确认的记录为准。`,
      "交付时，双方应核对物业现状、钥匙、家具设备及水电表读数，并在交接清单上签署。",
    ]),
    clause(3, "租金及付款安排", [
      `每月租金为 ${rent}；每 ${interval} 个月支付一次，每月 ${shown(order.rentDueDay)} 日为约定交租日。首期不足月${firstProration}，末期不足月${lastProration}。`,
      "收款账户、付款方式、首期应付款及具体到期日应由双方在签署前核对；本草稿不代替付款凭证。",
    ]),
    clause(4, "押金", [
      `约定押金为 ${deposit}，押付方式为${plan}。押金的支付时间、扣除范围、结算和退还期限，应由双方在签署前明确约定，并以适用法律为准。`,
      "押金与租金分别列账；若发生扣款，双方应核对扣款项目、金额和支持凭证。",
    ]),
    clause(5, "物业使用、费用与维修", [
      "乙方应按双方确认的用途合理使用物业，并妥善保管交付的设施。管理费、水电、网络、差饷及其他经常性费用的承担方式，应在签署前逐项确认。",
      "设施维修、损坏通知、紧急进入物业和保险安排，应由双方结合物业实际状况另行约定。",
    ]),
    clause(6, "续租、提前终止与交还", [
      "续租申请时间、租金调整，以及提前终止的通知期限、条件和费用，如有，应在签署前写明。",
      "租期届满或依法、依约终止时，双方应办理交还、抄录表数、核对费用并完成押金结算。",
    ]),
    clause(7, "通知、争议及其他", [
      "双方应在签署时确认可接收通知的地址、电话和电子邮箱；联系方式变更应及时告知对方。争议处理方式以双方最终签署文本和适用法律为准。",
      "本草稿根据录单资料自动生成。双方应核实身份、物业权属、金额及待确认事项；最终约定以签署文本和经双方确认的附件为准。",
    ]),
  ].join("");
  return `<!doctype html><html lang="zh-Hans"><head><meta charset="UTF-8"><style>
    *{box-sizing:border-box}body{margin:0;padding:0 17mm;color:#243047;font:11px/1.65 "PingFang SC","Microsoft YaHei",Arial,sans-serif}
    header{border-bottom:2px solid #b28c54;padding:0 0 9px;margin-bottom:15px;display:flex;justify-content:space-between;align-items:end}
    .brand{color:#182944;font-size:12px;font-weight:700;letter-spacing:1px}.brand small{display:block;color:#7f8da1;font-size:9px;font-weight:400;letter-spacing:0}
    .draft{color:#9b6b3a;font-size:10px;font-weight:700}h1{text-align:center;font-size:22px;letter-spacing:4px;margin:16px 0 4px;color:#172941}
    .subtitle{text-align:center;color:#708198;font-size:10px;margin:0 0 14px}.notice{background:#f6f7f9;border-left:3px solid #b28c54;padding:8px 11px;margin:0 0 15px;color:#52627a}
    .section{margin:15px 0}.section-title{font-size:12px;font-weight:700;color:#172941;background:#f1f3f6;padding:5px 9px;border-left:3px solid #b28c54;margin-bottom:9px}
    .parties{display:grid;grid-template-columns:1fr 1fr;gap:10px}.party{border:1px solid #dfe4eb;padding:10px;min-height:118px}.party strong{display:block;border-bottom:1px solid #e8edf2;padding-bottom:5px;margin-bottom:6px;color:#172941}
    .field{display:flex;gap:6px;margin:3px 0}.field span{color:#718096;white-space:nowrap;min-width:62px}.field b{font-weight:400;overflow-wrap:anywhere}
    table{width:100%;border-collapse:collapse;table-layout:fixed}th,td{border:1px solid #dfe4eb;padding:7px 9px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#f6f7f9;color:#63738a;font-weight:500;width:18%}td{width:32%}
    .clause{margin:13px 0;break-inside:avoid-page}.clause h3{font-size:12px;color:#172941;border-bottom:1px solid #e5e9ee;padding-bottom:4px;margin:0 0 5px}.clause p{margin:4px 0;text-align:justify}
    .template-terms{white-space:pre-wrap;overflow-wrap:anywhere;line-height:1.8}.checklist{display:grid;grid-template-columns:1fr 1fr;gap:5px 22px;padding:8px 10px;border:1px solid #dfe4eb}.checklist div{border-bottom:1px solid #e8edf2;min-height:29px}
    .signature{display:grid;grid-template-columns:1fr 1fr;gap:18px;margin-top:13px}.signature>div{border:1px solid #dfe4eb;padding:11px;min-height:115px}.signature strong{display:block;color:#172941;margin-bottom:27px}.sign-line{border-bottom:1px solid #9aa8b9;margin-bottom:8px}.muted{color:#78879a;font-size:9px}
    @media print{.section-title,.party,.signature>div{break-inside:avoid-page}}
  </style></head><body>
    <header><div class="brand">SUPREME BAY<small>租赁管理系统</small></div><div class="draft">待签署草稿 · 请双方核对</div></header>
    <h1>物业租赁合同</h1><p class="subtitle">订单编号 ${esc(order.orderNo)} · 生成日期 ${date(new Date())}</p>
    <p class="notice">本文件根据系统录入资料自动生成。空白及“签署前填写 / 确认”事项须由双方补充核对；未签署前仅作合同草稿。</p>
    <div class="section"><div class="section-title">一、签约方资料</div><div class="parties">
      <div class="party"><strong>出租方（甲方）</strong>${row("名称", lessorName)}${row("证件／登记", lessorNumber)}${row("联系人", lessorContact)}${row("联系电话", lessorPhone)}</div>
      <div class="party"><strong>承租方（乙方） · ${order.tenantType === "COMPANY" ? "公司" : "个人"}</strong>${row("名称", order.tenantName)}${row("证件／登记", order.tenantRegistrationNo)}${row("联系人", order.tenantContactName || (order.tenantType === "PERSON" ? order.tenantName : undefined))}${row("联系电话", order.tenantPhone)}${row("电子邮箱", order.tenantEmail)}</div>
    </div></div>
    <div class="section"><div class="section-title">二、物业及主要租赁条件</div><table>
      <tr><th>项目</th><td>${esc(shown(project?.name))}</td><th>单位</th><td>${esc(shown(unit?.unitNo))}</td></tr>
      <tr><th>物业地址</th><td colspan="3">${esc(shown(address))}</td></tr>
      <tr><th>租期开始</th><td>${date(order.startsOn)}</td><th>租期结束</th><td>${date(order.endsOn)}</td></tr>
      <tr><th>每月租金</th><td>${esc(rent)}</td><th>押金</th><td>${esc(deposit)}</td></tr>
      <tr><th>付款频率</th><td>每 ${interval} 个月</td><th>交租日</th><td>每月 ${esc(shown(order.rentDueDay))} 日</td></tr>
      <tr><th>押付方式</th><td colspan="3">${esc(plan)}</td></tr>
      <tr><th>首期不足月</th><td>${firstProration}</td><th>末期不足月</th><td>${lastProration}</td></tr>
    </table></div>
    <div class="section"><div class="section-title">三、合同条款</div>${templateBody?.trim() ? `<div class="template-terms">${esc(templateBody.trim())}</div>` : defaultClauses}</div>
    <div class="section"><div class="section-title">四、特别约定与签署前核对</div>
      <p>${esc(shown(order.remark, "暂无订单备注；如有特别约定，请在签署前补充。"))}</p>
      <p class="muted">请核对：出租方身份及权属、物业用途、费用分担、维修责任、提前终止与续租、押金退还，以及所需附件。项目模板条款如与主要条件不一致，应在签署前由双方厘清。</p>
    </div>
    <div class="section"><div class="section-title">五、物业交接清单（签署时填写）</div><div class="checklist">
      <div>交付日期：____________________</div><div>钥匙／门禁：____________________</div>
      <div>水表读数：____________________</div><div>电表读数：____________________</div>
      <div>家具及设备：__________________</div><div>物业现状／附件：________________</div>
    </div></div>
    <div class="section"><div class="section-title">六、双方签署</div><p>双方已阅读并确认本合同及经双方确认的附件内容。</p>
      <div class="signature"><div><strong>出租方（甲方）签署／盖章</strong><div class="sign-line"></div>签署日期：____________________</div>
      <div><strong>承租方（乙方）签署／盖章</strong><div class="sign-line"></div>签署日期：____________________</div></div>
    </div>
  </body></html>`;
}
