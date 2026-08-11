export function table(rows: Record<string, unknown>[], columns?: string[]): string {
  if (rows.length === 0) return "(none)";
  const cols = columns ?? Object.keys(rows[0]);
  const cells = rows.map((row) => cols.map((c) => formatCell(row[c])));
  const widths = cols.map((c, i) => Math.max(c.length, ...cells.map((r) => r[i].length)));

  const line = (values: string[]) => values.map((v, i) => v.padEnd(widths[i])).join("  ");
  const out = [line(cols.map((c) => c.toUpperCase())), ...cells.map(line)];
  return out.join("\n");
}

function formatCell(value: unknown): string {
  if (value === undefined || value === null) return "-";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

export function bytesToHuman(bytes: number | undefined): string {
  if (bytes === undefined) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }
  return `${value.toFixed(1)} ${units[unit]}`;
}
