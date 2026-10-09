type BillPeriod = {
  orderId?: string | null;
  feeType?: string;
  periodStart?: Date | string | null;
  periodEnd?: Date | string | null;
};
const dateText = (date: Date | string | null | undefined) =>
  date instanceof Date ? date.toISOString().slice(0, 10) : date?.slice(0, 10);

function ordinal(n: number): string {
  const digits = "零一二三四五六七八九";
  if (n < 10) return digits[n];
  if (n < 100)
    return `${n < 20 ? "" : digits[Math.floor(n / 10)]}十${n % 10 ? digits[n % 10] : ""}`;
  return String(n);
}

/** Number actual rental periods across the entire order, never the visible page.
 * Void periods retain their place; replacement bills with the same start share it.
 */
export function billTitles(history: BillPeriod[]) {
  const periods = new Map<string, Set<string>>();
  for (const bill of history) {
    const start = dateText(bill.periodStart);
    if (bill.feeType !== "RENT" || !bill.orderId || !start) continue;
    if (!periods.has(bill.orderId)) periods.set(bill.orderId, new Set());
    periods.get(bill.orderId)!.add(start);
  }
  const indexes = new Map(
    [...periods].map(([id, dates]) => [
      id,
      new Map([...dates].sort().map((date, index) => [date, index + 1])),
    ]),
  );
  return (bill: BillPeriod) => {
    const start = dateText(bill.periodStart),
      end = dateText(bill.periodEnd);
    const rentInstallment =
      bill.feeType === "RENT" && bill.orderId && start
        ? (indexes.get(bill.orderId)?.get(start) ?? null)
        : null;
    const type =
      bill.feeType === "RENT"
        ? "租金"
        : bill.feeType === "DEPOSIT"
          ? "押金"
          : "其他费用";
    const label = rentInstallment ? `${ordinal(rentInstallment)}期租金` : type;
    return {
      rentInstallment,
      billTitle: start && end ? `${label}—${start} 至 ${end}` : label,
    };
  };
}

/** Call only with bills whose authorization has already been checked. */
export async function loadBillTitles(db: any, bills: BillPeriod[]) {
  const orderIds = [
    ...new Set(
      bills
        .filter((b) => b.feeType === "RENT")
        .map((b) => b.orderId)
        .filter(Boolean),
    ),
  ];
  const history: BillPeriod[] = orderIds.length
    ? await db.income.findMany({
        where: {
          orderId: { in: orderIds },
          recordType: "RECEIVABLE",
          feeType: "RENT",
          deletedAt: null,
        },
        select: {
          orderId: true,
          feeType: true,
          periodStart: true,
          periodEnd: true,
        },
      })
    : [];
  return billTitles(history);
}
