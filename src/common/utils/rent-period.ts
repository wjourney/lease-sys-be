import { number } from "./value";
export function plusMonths(date: Date, months: number) {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const max = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0),
  ).getUTCDate();
  d.setUTCDate(Math.min(day, max));
  return d;
}
export const dayAfter = (d: Date) => new Date(d.getTime() + 86400000);
export function rentPeriod(order: any, start: Date) {
  const last = new Date(
    Math.min(
      plusMonths(start, order.paymentIntervalMonths).getTime() - 86400000,
      order.endsOn.getTime(),
    ),
  );
  // Calendar-month proration, with decimal arithmetic and one final rounding.
  let cursor = new Date(start);
  let amount = number(0);
  while (cursor <= last) {
    const endMonth = new Date(
      Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 0),
    );
    const end = new Date(Math.min(endMonth.getTime(), last.getTime()));
    const days = (end.getTime() - cursor.getTime()) / 86400000 + 1;
    const full = endMonth.getUTCDate();
    const partial = days < full;
    const isFirst = cursor.getTime() === order.startsOn.getTime();
    const isLast = end.getTime() === order.endsOn.getTime();
    const prorate =
      (!isFirst || order.firstPeriodProration) &&
      (!isLast || order.lastPeriodProration);
    amount = amount.add(
      number(order.monthlyRent).mul(
        partial && prorate ? number(days).div(full) : 1,
      ),
    );
    cursor = dayAfter(end);
  }
  return { end: last, amount: amount.toDecimalPlaces(2) };
}
