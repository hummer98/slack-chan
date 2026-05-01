import type { ColorFns } from "../ansi.ts";

const COL_GAP = "  ";

/**
 * Auto-sized table with bold + cyan headers and a dim ─ separator row.
 * Cell padding is performed BEFORE colour application so ANSI sequences
 * never participate in width calculation.
 *
 * Width calculation uses `String#length` (UTF-16 code units); full-width
 * characters (CJK etc.) may misalign — same caveat as `human/table.ts`.
 */
export function formatRichTable(
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
  lines.push(joinRow(headers, widths, (s) => colors.bold(colors.cyan(s))));
  const seps = widths.map((w) => "─".repeat(w));
  lines.push(joinRow(seps, widths, colors.dim));
  for (const row of rows) {
    const cells = row.map((c) => c ?? "");
    lines.push(joinRow(cells, widths, identity));
  }
  return `${lines.join("\n")}\n`;
}

function identity(s: string): string {
  return s;
}

function joinRow(
  cells: readonly string[],
  widths: readonly number[],
  paint: (s: string) => string,
): string {
  const padded = cells.map((c, i) => c.padEnd(widths[i] ?? c.length, " "));
  const painted = padded.map((c) => paint(c));
  // Trim trailing whitespace on the rendered (post-paint) line so the last
  // column does not leave dangling spaces. ANSI sequences end in `m` so the
  // regex only strips raw spaces, never escape codes.
  return painted.join(COL_GAP).replace(/[ \t]+$/u, "");
}
