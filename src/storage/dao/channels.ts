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

export function getOne(db: Database, team_id: string, channel_id: string): ChannelRow | null {
  const row = db
    .query<ChannelRow, [string, string]>(
      "SELECT * FROM channels WHERE team_id = ? AND channel_id = ?",
    )
    .get(team_id, channel_id);
  return row ?? null;
}

export function getByName(db: Database, team_id: string, name: string): ChannelRow | null {
  const row = db
    .query<ChannelRow, [string, string]>(
      "SELECT * FROM channels WHERE team_id = ? AND name = ? " +
        "ORDER BY COALESCE(fetched_at, 0) DESC LIMIT 1",
    )
    .get(team_id, name);
  return row ?? null;
}

export function countByTeam(
  db: Database,
  team_id: string,
  opts: { is_member?: 0 | 1 } = {},
): number {
  if (opts.is_member === undefined) {
    const row = db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM channels WHERE team_id = ?")
      .get(team_id);
    return row?.n ?? 0;
  }
  const row = db
    .query<{ n: number }, [string, number]>(
      "SELECT COUNT(*) AS n FROM channels WHERE team_id = ? AND is_member = ?",
    )
    .get(team_id, opts.is_member);
  return row?.n ?? 0;
}

export function maxLastSyncedTs(db: Database, team_id: string): string | null {
  const row = db
    .query<{ m: string | null }, [string]>(
      "SELECT MAX(last_synced_ts) AS m FROM channels WHERE team_id = ?",
    )
    .get(team_id);
  return row?.m ?? null;
}
