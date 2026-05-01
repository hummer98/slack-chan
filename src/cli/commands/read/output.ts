import type { Database } from "bun:sqlite";
import type { OutputFormat } from "../../../config/types.ts";
import { isColorEnabled, makeColors } from "../../../output/ansi.ts";
import { selectFormatter } from "../../../output/format.ts";
import { formatTimeline, type TimelineEntry } from "../../../output/human/index.ts";
import * as channelsDao from "../../../storage/dao/channels.ts";
import * as messagesDao from "../../../storage/dao/messages.ts";
import * as usersDao from "../../../storage/dao/users.ts";
import type { ChannelRow, MessageRow } from "../../../storage/types.ts";
import type { ReadArgs } from "./argv.ts";

export interface MessageRecord {
  team_id: string;
  channel_id: string;
  ts: string;
  thread_ts: string | null;
  user_id: string | null;
  type: string | null;
  subtype: string | null;
  text: string | null;
  edited_ts: string | null;
  deleted: boolean;
}

export function toMessageRecord(row: MessageRow): MessageRecord {
  return {
    team_id: row.team_id,
    channel_id: row.channel_id,
    ts: row.ts,
    thread_ts: row.thread_ts,
    user_id: row.user_id,
    type: row.type,
    subtype: row.subtype,
    text: row.text,
    edited_ts: row.edited_ts,
    deleted: row.deleted === 1,
  };
}

export interface WriteChannelOutputOptions {
  team_id: string;
  channel_id: string;
  db: Database;
  args: ReadArgs;
  format: OutputFormat;
  stdout: NodeJS.WritableStream;
  now(): number;
  /** Override TTY detection. Defaults to `isColorEnabled()` for `--human`. */
  isTTY?: boolean;
  /** IANA tz for human timestamp display. Defaults to system local. */
  tz?: string;
}

export function writeChannelOutput(opts: WriteChannelOutputOptions): void {
  const since_ts =
    opts.args.since_sec === null ? null : `${opts.now() - opts.args.since_sec}.000000`;
  const rows = messagesDao.getForOutput(opts.db, opts.team_id, opts.channel_id, {
    limit: opts.args.limit,
    since_ts,
  });
  // 出力は古い→新しい (LLM context フレンドリー)。getForOutput は DESC なので reverse。
  rows.reverse();
  if (opts.format === "human") {
    opts.stdout.write(renderMessagesHuman(rows, opts));
    return;
  }
  const f = selectFormatter(opts.format);
  for (const row of rows) {
    opts.stdout.write(f.format(toMessageRecord(row)));
  }
}

export interface WriteThreadOutputOptions {
  team_id: string;
  channel_id: string;
  thread_ts: string;
  db: Database;
  args: ReadArgs;
  format: OutputFormat;
  stdout: NodeJS.WritableStream;
  now(): number;
  isTTY?: boolean;
  tz?: string;
}

export function writeThreadOutput(opts: WriteThreadOutputOptions): void {
  const rows = messagesDao.getThread(opts.db, opts.team_id, opts.channel_id, opts.thread_ts);
  let filtered = rows;
  if (opts.args.since_sec !== null) {
    const since_ts = `${opts.now() - opts.args.since_sec}.000000`;
    filtered = filtered.filter((r) => r.ts >= since_ts);
  }
  if (filtered.length > opts.args.limit) {
    filtered = filtered.slice(0, opts.args.limit);
  }
  if (opts.format === "human") {
    opts.stdout.write(renderMessagesHuman(filtered, opts));
    return;
  }
  const f = selectFormatter(opts.format);
  for (const row of filtered) {
    opts.stdout.write(f.format(toMessageRecord(row)));
  }
}

interface HumanRenderOpts {
  team_id: string;
  db: Database;
  isTTY?: boolean;
  tz?: string;
}

/**
 * Render message rows as a human-readable timeline. Channel and user labels are
 * resolved from the DAO cache; unresolved IDs fall back to raw `Cxxx` / `Uxxx`.
 */
export function renderMessagesHuman(rows: readonly MessageRow[], opts: HumanRenderOpts): string {
  const colors = makeColors(opts.isTTY === undefined ? isColorEnabled() : opts.isTTY);
  const tz = opts.tz ?? defaultTz();
  const entries: TimelineEntry[] = [];
  const channelCache = new Map<string, ChannelRow | null>();
  const userCache = new Map<string, string>();
  for (const row of rows) {
    let channelRow = channelCache.get(row.channel_id);
    if (channelRow === undefined) {
      channelRow = channelsDao.getOne(opts.db, opts.team_id, row.channel_id);
      channelCache.set(row.channel_id, channelRow);
    }
    const channel_label = channelLabel(channelRow, row.channel_id);
    let user_label: string;
    if (row.user_id === null) {
      user_label = "(no user)";
    } else if (userCache.has(row.user_id)) {
      user_label = userCache.get(row.user_id) as string;
    } else {
      const u = usersDao.get(opts.db, opts.team_id, row.user_id);
      user_label = u?.name ? `@${u.name}` : row.user_id;
      userCache.set(row.user_id, user_label);
    }
    const is_thread = row.thread_ts !== null;
    entries.push({
      ts: row.ts,
      channel_label,
      user_label,
      text: row.text,
      is_thread,
      tz,
    });
  }
  return formatTimeline(entries, colors);
}

function channelLabel(row: ChannelRow | null, channel_id: string): string {
  if (row === null) return channel_id;
  if (row.type === "im") {
    return row.name ? `@${row.name}` : channel_id;
  }
  return row.name ? `#${row.name}` : channel_id;
}

function defaultTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
