/** Rows of a text table, columns padded with spaces. The last column is not padded, so lines carry no trailing spaces. */
export function textTable(rows: string[][]): string[] {
  const widths = rows[0]!.map((_, c) => Math.max(...rows.map((r) => r[c]!.length)));
  return rows.map((r) => r.map((cell, c) => (c === r.length - 1 ? cell : cell.padEnd(widths[c]!))).join('  ').trimEnd());
}
