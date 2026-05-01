import type { OutputFormat } from "../config/types.ts";
import { HumanFormatter } from "./human.ts";
import { JsonlFormatter } from "./jsonl.ts";
import { ToonFormatter } from "./toon.ts";

export interface Formatter {
  /**
   * Format a single record. Newline (or block separator) is the formatter's
   * responsibility — the caller writes the returned string straight to stdout.
   */
  format(record: unknown): string;
  /**
   * Optional bulk formatter for renderers that need multi-record context
   * (e.g. tabular human output). When undefined, callers should fall back to
   * `records.map(f.format).join("")`.
   */
  formatBatch?(records: readonly unknown[]): string;
}

export function selectFormatter(format: OutputFormat): Formatter {
  switch (format) {
    case "jsonl":
      return new JsonlFormatter();
    case "toon":
      return new ToonFormatter();
    case "human":
      return new HumanFormatter();
    case "rich":
      // ADR-0014: per-command renderers handle "rich" upstream; record-level
      // fallback (api / post / sync) reuses HumanFormatter (pretty JSON + dim).
      return new HumanFormatter();
  }
}
