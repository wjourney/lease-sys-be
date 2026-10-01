export function csvExport(rows: Record<string, any>[]) {
  const cols = Object.keys(rows[0] ?? {}).filter(
    (k) => !k.endsWith("Snapshot") && typeof rows[0][k] !== "object",
  );
  const cell = (v: any) =>
    '"' +
    String(v ?? "")
      .replace(/^[=+@-]/, (first) => "'" + first)
      .replaceAll('"', '""') +
    '"';
  return (
    "\uFEFF" +
    [
      cols.map(cell).join(","),
      ...rows.map((row) => cols.map((k) => cell(row[k])).join(",")),
    ].join("\r\n")
  );
}
