import type { Database } from "bun:sqlite";
import type { OutputFormat } from "../../../config/types.ts";
import { isColorEnabled, isEmojiEnabled, makeColors } from "../../../output/ansi.ts";
import { selectFormatter } from "../../../output/format.ts";
import {
  formatTimeline,
  type HighlightRange,
  type TimelineEntry,
} from "../../../output/human/index.ts";
import { formatRichTimeline, getGlyphs } from "../../../output/rich/index.ts";
import * as channelsDao from "../../../storage/dao/channels.ts";
import * as usersDao from "../../../storage/dao/users.ts";
import type { ChannelRow } from "../../../storage/types.ts";
import type { MergedHit } from "./merge.ts";

export interface SearchHitRecord {
  team_id: string;
  channel_id: string;
  ts: string;
  thread_ts: string | null;
  user_id: string | null;
  type: string | null;
  subtype: string | null;
  text: string | null;
  edited_ts: string | null;
  deleted: false;
  source: "cache" | "remote" | "both";
  permalink: string | null;
}

export function toSearchHitRecord(hit: MergedHit): SearchHitRecord {
  return {
    team_id: hit.team_id,
    channel_id: hit.channel_id,
    ts: hit.ts,
    thread_ts: hit.thread_ts,
    user_id: hit.user_id,
    type: hit.type,
    subtype: hit.subtype,
    text: hit.text,
    edited_ts: hit.edited_ts,
    deleted: false,
    source: hit.source,
    permalink: hit.permalink,
  };
}

export interface WriteSearchOutputOpts {
  merged: MergedHit[];
  format: OutputFormat;
  stdout: NodeJS.WritableStream;
  /** Required when format === "human" / "rich". Used as substring source for highlight. */
  query?: string;
  /** Required when format === "human" / "rich". DAO uses team_id to resolve labels. */
  team_id?: string;
  /** Required when format === "human" / "rich". */
  db?: Database;
  isTTY?: boolean;
  /** Override emoji detection (only affects `--rich`). */
  emojiEnabled?: boolean;
  tz?: string;
}

export function writeSearchOutput(opts: WriteSearchOutputOpts): void {
  if (opts.merged.length === 0) return;
  if (opts.format === "human" || opts.format === "rich") {
    if (opts.team_id === undefined || opts.db === undefined) {
      throw new Error(`writeSearchOutput: team_id and db are required for --${opts.format}`);
    }
    const renderOpts = {
      team_id: opts.team_id,
      db: opts.db,
      query: opts.query ?? "",
      isTTY: opts.isTTY,
      emojiEnabled: opts.emojiEnabled,
      tz: opts.tz,
    };
    opts.stdout.write(
      opts.format === "human"
        ? renderSearchHumanFromHits(opts.merged, renderOpts)
        : renderSearchRichFromHits(opts.merged, renderOpts),
    );
    return;
  }
  const records = opts.merged.map(toSearchHitRecord);
  const f = selectFormatter(opts.format);
  if (typeof f.formatBatch === "function") {
    opts.stdout.write(f.formatBatch(records));
    return;
  }
  for (const r of records) {
    opts.stdout.write(f.format(r));
  }
}

interface RenderSearchHumanOpts {
  team_id: string;
  db: Database;
  query: string;
  isTTY?: boolean;
  emojiEnabled?: boolean;
  tz?: string;
}

function buildSearchTimelineEntries(
  hits: readonly MergedHit[],
  opts: RenderSearchHumanOpts,
  tz: string,
): TimelineEntry[] {
  const tokens = extractQueryTokens(opts.query);
  const channelCache = new Map<string, ChannelRow | null>();
  const userCache = new Map<string, string>();
  // Display oldest → newest like read does (LLM friendly).
  const sorted = [...hits].sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : 0));
  return sorted.map((hit) => {
    let channelRow = channelCache.get(hit.channel_id);
    if (channelRow === undefined) {
      channelRow = channelsDao.getOne(opts.db, opts.team_id, hit.channel_id);
      channelCache.set(hit.channel_id, channelRow);
    }
    const channel_label = channelLabel(channelRow, hit.channel_id);
    let user_label: string;
    if (hit.user_id === null) {
      user_label = "(no user)";
    } else if (userCache.has(hit.user_id)) {
      user_label = userCache.get(hit.user_id) as string;
    } else {
      const u = usersDao.get(opts.db, opts.team_id, hit.user_id);
      user_label = u?.name ? `@${u.name}` : hit.user_id;
      userCache.set(hit.user_id, user_label);
    }
    return {
      ts: hit.ts,
      channel_label,
      user_label,
      text: hit.text,
      is_thread: hit.thread_ts !== null,
      tz,
      highlight: hit.text !== null ? findHighlights(hit.text, tokens) : undefined,
    };
  });
}

export function renderSearchHumanFromHits(
  hits: readonly MergedHit[],
  opts: RenderSearchHumanOpts,
): string {
  const colors = makeColors(opts.isTTY === undefined ? isColorEnabled() : opts.isTTY);
  const tz = opts.tz ?? defaultTz();
  const entries = buildSearchTimelineEntries(hits, opts, tz);
  return formatTimeline(entries, colors);
}

export function renderSearchRichFromHits(
  hits: readonly MergedHit[],
  opts: RenderSearchHumanOpts,
): string {
  const colors = makeColors(opts.isTTY === undefined ? isColorEnabled() : opts.isTTY);
  const glyphs = getGlyphs(opts.emojiEnabled ?? isEmojiEnabled());
  const tz = opts.tz ?? defaultTz();
  const entries = buildSearchTimelineEntries(hits, opts, tz);
  return formatRichTimeline(entries, colors, glyphs);
}

function channelLabel(row: ChannelRow | null, channel_id: string): string {
  if (row === null) return channel_id;
  if (row.type === "im") {
    return row.name ? `@${row.name}` : channel_id;
  }
  return row.name ? `#${row.name}` : channel_id;
}

/**
 * Strip Slack search operators (`channel:`, `from:`, `in:`, `before:`, `after:` etc.)
 * and double-quote phrases, return remaining whitespace-split tokens.
 * MVP: simple substring match — not the same as FTS5 trigram offsets.
 */
export function extractQueryTokens(query: string): string[] {
  if (query.trim().length === 0) return [];
  // Pull out quoted phrases (treat the whole phrase as one token).
  const phrases: string[] = [];
  const stripped = query.replace(/"([^"]+)"/g, (_, phrase) => {
    phrases.push(phrase);
    return " ";
  });
  // Drop operator tokens.
  const operatorRe = /^(channel|from|in|to|before|after|on|during|has|with):/i;
  const bare = stripped.split(/\s+/u).filter((t) => t.length > 0 && !operatorRe.test(t));
  return [...phrases, ...bare].filter((t) => t.length > 0);
}

function findHighlights(text: string, tokens: readonly string[]): HighlightRange[] {
  const ranges: HighlightRange[] = [];
  const lower = text.toLowerCase();
  for (const tok of tokens) {
    const t = tok.toLowerCase();
    if (t.length === 0) continue;
    let idx = 0;
    while (true) {
      const found = lower.indexOf(t, idx);
      if (found === -1) break;
      ranges.push({ start: found, end: found + t.length });
      idx = found + t.length;
    }
  }
  return ranges;
}

function defaultTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
