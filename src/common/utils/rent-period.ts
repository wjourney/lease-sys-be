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
  if (order.billingVersion === 2) {
    let index = (start.getUTCFullYear() - order.startsOn.getUTCFullYear()) * 12 + start.getUTCMonth() - order.startsOn.getUTCMonth();
    while (plusMonths(order.startsOn, index) > start) index--;
    const periodStart = plusMonths(order.startsOn, index);
    const next = plusMonths(order.startsOn, index + 1);
    const end = new Date(Math.min(next.getTime() - 86400000, order.endsOn.getTime()));
    const partial = start > periodStart || end.getTime() + 86400000 < next.getTime();
    const prorate = (!order.firstPeriodProration && start.getTime() === order.startsOn.getTime()) || (!order.lastPeriodProration && end.getTime() === order.endsOn.getTime()) ? false : true;
    const ratio = partial && prorate ? number(end.getTime() - start.getTime() + 86400000).div(next.getTime() - periodStart.getTime()) : number(1);
    return { end, amount: number(order.monthlyRent).mul(ratio).toDecimalPlaces(2) };
  }
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
