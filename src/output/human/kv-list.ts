import type { ColorFns } from "../ansi.ts";

export interface KvEntry {
  label: string;
  value: string;
  emphasize?: boolean;
}

export interface FormatKvListOptions {
  /** Number of leading spaces. Default 2. */
  indent?: number;
}

export function formatKvList(
  entries: readonly KvEntry[],
  colors: ColorFns,
  opts: FormatKvListOptions = {},
): string {
  if (entries.length === 0) return "";
  const indent = opts.indent ?? 2;
  const pad = " ".repeat(indent);
  const labelWidth = Math.max(...entries.map((e) => e.label.length));
  const lines: string[] = [];
  for (const e of entries) {
    const padded = e.label.padEnd(labelWidth, " ");
    const label = e.emphasize ? colors.bold(padded) : padded;
    lines.push(`${pad}${label} : ${e.value}`);
  }
  return `${lines.join("\n")}\n`;
}
