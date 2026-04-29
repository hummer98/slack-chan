import type { Database } from "bun:sqlite";
import type { OutputFormat } from "../../../config/types.ts";
import { selectFormatter } from "../../../output/format.ts";
import * as messagesDao from "../../../storage/dao/messages.ts";
import type { MessageRow } from "../../../storage/types.ts";
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
  const f = selectFormatter(opts.format);
  for (const row of filtered) {
    opts.stdout.write(f.format(toMessageRecord(row)));
  }
}
