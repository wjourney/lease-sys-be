/** DATE columns are UTC midnight representations of Hong Kong business dates. */
export function leaseToday(now = new Date()) {
  const hongKong = new Date(now.getTime() + 8 * 60 * 60 * 1000);
  return new Date(hongKong.toISOString().slice(0, 10) + "T00:00:00.000Z");
}
