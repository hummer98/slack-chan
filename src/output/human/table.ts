import type { ColorFns } from "../ansi.ts";

const COL_GAP = "  ";

/**
 * Format a table with auto-sized columns.
 * Column width = max(header[i].length, max(row[i].length)).
 * Columns are joined with 2-space padding. Separator row uses U+2500 (─),
 * sized to each column's content width (no inter-column padding inside the dashes).
 * Trailing whitespace per line is trimmed for cleaner output.
 *
 * Note: width is calculated as `String#length` (UTF-16 code units), so full-width
 * characters (CJK etc.) may misalign. ADR-0013 §Open Questions tracks this.
 */
export function formatTable(
  headers: readonly string[],
  rows: readonly (readonly string[])[],
  colors: ColorFns,
): string {
  const numCols = headers.length;
  const widths: number[] = headers.map((h) => h.length);
  for (const row of rows) {
    for (let i = 0; i < numCols; i++) {
      const cell = row[i] ?? "";
      const w = widths[i] ?? 0;
      if (cell.length > w) widths[i] = cell.length;
    }
  }

  const lines: string[] = [];
  // Header
  lines.push(joinRow(headers, widths));
  // Separator
  const seps = widths.map((w) => "─".repeat(w));
  lines.push(joinRow(seps, widths));
  // Rows
  for (const row of rows) {
    const cells = row.map((c) => c ?? "");
    lines.push(joinRow(cells, widths));
  }
  // Apply colors (currently no-op; kept as a hook for future bold-header etc.)
  void colors;
  return `${lines.join("\n")}\n`;
}

function joinRow(cells: readonly string[], widths: readonly number[]): string {
  const padded = cells.map((c, i) => c.padEnd(widths[i] ?? c.length, " "));
  return padded.join(COL_GAP).replace(/\s+$/u, "");
}
