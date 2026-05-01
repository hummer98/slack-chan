import type { ColorFns } from "../ansi.ts";

export interface RichKvEntry {
  label: string;
  value: string;
  /** Optional emoji prefix. Empty string skips the prefix column. */
  glyph?: string;
}

export interface FormatRichKvListOptions {
  /** Number of leading spaces. Default 2. */
  indent?: number;
}

/**
 * Render a key/value list with optional emoji prefixes and a bold label.
 * Label column is right-padded to align colons across all entries; the glyph,
 * when present, is emitted before the label and excluded from the width
 * calculation (so emoji-on / emoji-off both align cleanly).
 */
export function formatRichKvList(
  entries: readonly RichKvEntry[],
  colors: ColorFns,
  opts: FormatRichKvListOptions = {},
): string {
  if (entries.length === 0) return "";
  const indent = opts.indent ?? 2;
  const pad = " ".repeat(indent);
  const labelWidth = Math.max(...entries.map((e) => e.label.length));
  const anyGlyph = entries.some((e) => e.glyph !== undefined && e.glyph.length > 0);
  const lines: string[] = [];
  for (const e of entries) {
    const padded = e.label.padEnd(labelWidth, " ");
    const label = colors.bold(padded);
    const glyphPart = anyGlyph
      ? `${e.glyph !== undefined && e.glyph.length > 0 ? e.glyph : " "} `
      : "";
    lines.push(`${pad}${glyphPart}${label} : ${e.value}`);
  }
  return `${lines.join("\n")}\n`;
}
