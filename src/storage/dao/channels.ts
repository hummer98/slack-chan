import type { Database } from "bun:sqlite";
import type { ChannelRow } from "../types.ts";

export function upsert(db: Database, row: ChannelRow): void {
  db.prepare(
    `INSERT INTO channels (
       team_id, channel_id, name, type, topic, purpose,
       is_member, last_synced_ts, fetched_at
     ) VALUES (
       $team_id, $channel_id, $name, $type, $topic, $purpose,
       $is_member, $last_synced_ts, $fetched_at
     )
     ON CONFLICT(team_id, channel_id) DO UPDATE SET
       name           = excluded.name,
       type           = excluded.type,
       topic          = excluded.topic,
       purpose        = excluded.purpose,
       is_member      = excluded.is_member,
       last_synced_ts = excluded.last_synced_ts,
       fetched_at     = excluded.fetched_at`,
  ).run({
    $team_id: row.team_id,
    $channel_id: row.channel_id,
    $name: row.name,
    $type: row.type,
    $topic: row.topic,
    $purpose: row.purpose,
    $is_member: row.is_member,
    $last_synced_ts: row.last_synced_ts,
    $fetched_at: row.fetched_at,
  });
}

export function deleteByTeam(db: Database, team_id: string): void {
  db.prepare("DELETE FROM channels WHERE team_id = ?").run(team_id);
}

export function getLastSyncedTs(db: Database, team_id: string, channel_id: string): string | null {
  const row = db
    .query<{ last_synced_ts: string | null }, [string, string]>(
      "SELECT last_synced_ts FROM channels WHERE team_id = ? AND channel_id = ?",
    )
    .get(team_id, channel_id);
  return row ? row.last_synced_ts : null;
}
