import type { Database } from "bun:sqlite";
import type { FileRow } from "../types.ts";

export function upsert(db: Database, row: FileRow): void {
  db.prepare(
    `INSERT INTO files (
       team_id, file_id, channel_id, ts, name, mimetype, size,
       url_private, local_path, downloaded_at, raw_json
     ) VALUES (
       $team_id, $file_id, $channel_id, $ts, $name, $mimetype, $size,
       $url_private, $local_path, $downloaded_at, $raw_json
     )
     ON CONFLICT(team_id, file_id) DO UPDATE SET
       channel_id    = excluded.channel_id,
       ts            = excluded.ts,
       name          = excluded.name,
       mimetype      = excluded.mimetype,
       size          = excluded.size,
       url_private   = excluded.url_private,
       local_path    = COALESCE(excluded.local_path, local_path),
       downloaded_at = COALESCE(excluded.downloaded_at, downloaded_at),
       raw_json      = excluded.raw_json`,
  ).run({
    $team_id: row.team_id,
    $file_id: row.file_id,
    $channel_id: row.channel_id,
    $ts: row.ts,
    $name: row.name,
    $mimetype: row.mimetype,
    $size: row.size,
    $url_private: row.url_private,
    $local_path: row.local_path,
    $downloaded_at: row.downloaded_at,
    $raw_json: row.raw_json,
  });
}

export function get(db: Database, team_id: string, file_id: string): FileRow | null {
  const row = db
    .query<FileRow, [string, string]>("SELECT * FROM files WHERE team_id = ? AND file_id = ?")
    .get(team_id, file_id);
  return row ?? null;
}

export function markDownloaded(
  db: Database,
  team_id: string,
  file_id: string,
  local_path: string,
  downloaded_at: number,
): void {
  db.prepare(
    "UPDATE files SET local_path = ?, downloaded_at = ? WHERE team_id = ? AND file_id = ?",
  ).run(local_path, downloaded_at, team_id, file_id);
}
