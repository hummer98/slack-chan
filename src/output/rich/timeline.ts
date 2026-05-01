import type { ColorFns } from "../ansi.ts";
import { formatLocalTimestamp } from "../human/format.ts";
import type { HighlightRange, TimelineEntry } from "../human/timeline.ts";
import type { RichGlyphs } from "./format.ts";

const NO_TEXT = "(no text)";
const ENTRY_INDENT = "  ";
const BODY_INDENT = "    ";

/**
 * Render a timeline grouped by local date. Each date boundary emits a
 * "📅 YYYY-MM-DD" banner (bold + magenta); entries below show only HH:MM:SS.
 * Channel labels are bold cyan, user labels bold green, body indented under
 * each header. Highlight ranges (search hits) get bold + yellow-bg.
 */
export function formatRichTimeline(
  entries: readonly TimelineEntry[],
  colors: ColorFns,
  glyphs: RichGlyphs,
): string {
  if (entries.length === 0) return "";
  const blocks: string[] = [];
  let lastDate: string | null = null;
  for (const e of entries) {
    const localTs = formatLocalTimestamp(e.ts, e.tz);
    const date = localTs.slice(0, 10);
    if (date !== lastDate) {
      const prefix = glyphs.dateHeader.length > 0 ? `${glyphs.dateHeader} ` : "";
      blocks.push(colors.bold(colors.magenta(`${prefix}${date}`)));
      lastDate = date;
    }
    blocks.push(formatEntry(e, localTs, colors, glyphs));
  }
  // Each entry block already ends in `\n`; joining with `\n` therefore inserts
  // a blank line between consecutive entries (and between an entry and the
  // next date header), giving the timeline natural breathing room.
  return blocks.join("\n");
}

function formatEntry(
  e: TimelineEntry,
  localTs: string,
  colors: ColorFns,
  glyphs: RichGlyphs,
): string {
  const time = colors.dim(localTs.slice(11));
  const channel = colors.bold(colors.cyan(e.channel_label));
  const user = colors.bold(colors.green(e.user_label));
  let header = `${ENTRY_INDENT}${time}  ${channel}  ${user}`;
  if (e.is_thread && glyphs.threadIndicator.length > 0) {
    header += `  ${colors.dim(glyphs.threadIndicator)}`;
  }
  return `${header}\n${renderBody(e, colors)}\n`;
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
