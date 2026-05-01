import type { ColorFns } from "../ansi.ts";
import { formatLocalTimestamp } from "./format.ts";

export interface HighlightRange {
  /** Inclusive start index (UTF-16 code units). */
  start: number;
  /** Exclusive end index. */
  end: number;
}

export interface TimelineEntry {
  /** Slack `ts` (e.g. "1745978423.000000"). */
  ts: string;
  /** "#general" / "@user_dm" / "Cxxx" — caller-resolved channel label. */
  channel_label: string;
  /** "@name" / "Uxxx" — caller-resolved user label. */
  user_label: string;
  /** Message body. null shows "(no text)" placeholder. */
  text: string | null;
  /** Whether the entry is part of a thread. */
  is_thread: boolean;
  /** IANA timezone for ts → local format conversion. */
  tz: string;
  /** Substring ranges to highlight (search match). */
  highlight?: readonly HighlightRange[];
}

const THREAD_INDICATOR = "⤷ thread";
const NO_TEXT = "(no text)";
const BODY_INDENT = "  ";

export function formatTimeline(entries: readonly TimelineEntry[], colors: ColorFns): string {
  if (entries.length === 0) return "";
  const blocks: string[] = [];
  for (const e of entries) {
    blocks.push(formatEntry(e, colors));
  }
  return `${blocks.join("\n")}`;
}

function formatEntry(e: TimelineEntry, colors: ColorFns): string {
  const timestamp = colors.dim(formatLocalTimestamp(e.ts, e.tz));
  const channel = colors.cyan(e.channel_label);
  const user = colors.green(e.user_label);
  let header = `${timestamp}  ${channel}  ${user}`;
  if (e.is_thread) {
    header += `  ${colors.dim(THREAD_INDICATOR)}`;
  }
  const bodyLines = renderBody(e, colors);
  return `${header}\n${bodyLines}\n`;
}

function renderBody(e: TimelineEntry, colors: ColorFns): string {
  if (e.text === null || e.text === "") {
    return `${BODY_INDENT}${colors.dim(NO_TEXT)}`;
  }
  const highlighted =
    e.highlight && e.highlight.length > 0 ? applyHighlight(e.text, e.highlight, colors) : e.text;
  return highlighted
    .split("\n")
    .map((line) => `${BODY_INDENT}${line}`)
    .join("\n");
}

function applyHighlight(text: string, ranges: readonly HighlightRange[], colors: ColorFns): string {
  // Sort + merge overlapping ranges
  const sorted = [...ranges].sort((a, b) => a.start - b.start);
  const merged: HighlightRange[] = [];
  for (const r of sorted) {
    const last = merged.length > 0 ? merged[merged.length - 1] : undefined;
    if (last === undefined) {
      merged.push({ ...r });
      continue;
    }
    if (r.start <= last.end) {
      if (r.end > last.end) last.end = r.end;
    } else {
      merged.push({ ...r });
    }
  }
  const parts: string[] = [];
  let cursor = 0;
  for (const r of merged) {
    if (r.start > cursor) parts.push(text.slice(cursor, r.start));
    const slice = text.slice(r.start, r.end);
    if (slice.length > 0) parts.push(colors.bold(colors.yellowBg(slice)));
    cursor = r.end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return parts.join("");
}
