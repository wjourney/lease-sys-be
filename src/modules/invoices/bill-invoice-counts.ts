/** Receipts and invoices are queried in batches for already-authorized bills. */
export async function billInvoiceCounts(db: any, billIds: string[]) {
  const counts = new Map<string, number>();
  if (!billIds.length) return counts;
  const receipts = await db.income.findMany({
    where: {
      parentId: { in: billIds },
      recordType: "RECEIPT",
      status: "CONFIRMED",
      deletedAt: null,
    },
    select: { id: true, parentId: true },
  });
  if (!receipts.length) return counts;
  const billByReceipt = new Map<string, string>(
    receipts.map((r: any) => [r.id, r.parentId]),
  );
  const groups = await db.invoice.groupBy({
    by: ["incomeId"],
    where: {
      incomeId: { in: receipts.map((r: any) => r.id) },
      status: "ACTIVE",
      deletedAt: null,
    },
    _count: { _all: true },
  });
  for (const group of groups) {
    const billId = billByReceipt.get(group.incomeId);
    if (billId)
      counts.set(billId, (counts.get(billId) || 0) + group._count._all);
  }
  return counts;
}
