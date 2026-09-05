export function renderTable(
  headers: string[],
  rows: Array<Array<string | number>>,
): string {
  const textRows = rows.map((row) => row.map(String));
  const widths = headers.map((header, index) =>
    Math.max(
      header.length,
      ...textRows.map((row) => row[index]?.length ?? 0),
    ),
  );
  return [
    headers.map((header, index) => header.padEnd(widths[index] ?? 0)).join("  "),
    ...textRows.map((row) =>
      row
        .map((cell, index) => cell.padEnd(widths[index] ?? 0))
        .join("  "),
    ),
  ].join("\n");
}
