import type { Database } from "bun:sqlite";
import type { MessageRow, MessageUpsertInput } from "../types.ts";

export function upsert(db: Database, row: MessageUpsertInput): void {
  db.prepare(
    `INSERT INTO messages (
       team_id, channel_id, ts, thread_ts, user_id, type, subtype,
       text, edited_ts, raw_json, fetched_at
     ) VALUES (
       $team_id, $channel_id, $ts, $thread_ts, $user_id, $type, $subtype,
       $text, $edited_ts, $raw_json, $fetched_at
     )
     ON CONFLICT(team_id, channel_id, ts) DO UPDATE SET
       text       = excluded.text,
       edited_ts  = excluded.edited_ts,
       raw_json   = excluded.raw_json,
       fetched_at = excluded.fetched_at,
       thread_ts  = COALESCE(excluded.thread_ts, thread_ts),
       user_id    = COALESCE(excluded.user_id, user_id),
       type       = COALESCE(excluded.type, type),
       subtype    = COALESCE(excluded.subtype, subtype)`,
  ).run({
    $team_id: row.team_id,
    $channel_id: row.channel_id,
    $ts: row.ts,
    $thread_ts: row.thread_ts,
    $user_id: row.user_id,
    $type: row.type,
    $subtype: row.subtype,
    $text: row.text,
    $edited_ts: row.edited_ts,
    $raw_json: row.raw_json,
    $fetched_at: row.fetched_at,
  });
}

export function deleteByTeam(db: Database, team_id: string): void {
  db.prepare("DELETE FROM messages WHERE team_id = ?").run(team_id);
}

export interface GetAfterTsOptions {
  limit?: number;
  includeDeleted?: boolean;
}

export function getAfterTs(
  db: Database,
  team_id: string,
  channel_id: string,
  ts: string,
  opts: GetAfterTsOptions = {},
): MessageRow[] {
  const limit = opts.limit ?? 1000;
  const includeDeleted = opts.includeDeleted ?? false;
  return db
    .query<MessageRow, [string, string, string, number, number]>(
      `SELECT * FROM messages
       WHERE team_id = ? AND channel_id = ? AND ts > ?
         AND (? = 1 OR deleted = 0)
       ORDER BY ts ASC
       LIMIT ?`,
    )
    .all(team_id, channel_id, ts, includeDeleted ? 1 : 0, limit);
}

export function markDeleted(db: Database, team_id: string, channel_id: string, ts: string): void {
  db.prepare("UPDATE messages SET deleted = 1 WHERE team_id = ? AND channel_id = ? AND ts = ?").run(
    team_id,
    channel_id,
    ts,
  );
}

export function updateEdited(
  db: Database,
  team_id: string,
  channel_id: string,
  ts: string,
  patch: { text: string | null; edited_ts: string | null },
): void {
  db.prepare(
    "UPDATE messages SET text = ?, edited_ts = ? WHERE team_id = ? AND channel_id = ? AND ts = ?",
  ).run(patch.text, patch.edited_ts, team_id, channel_id, ts);
}
