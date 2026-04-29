import type { Database } from "bun:sqlite";
import type { WorkspaceRow } from "../types.ts";

export function insert(db: Database, row: WorkspaceRow): void {
  db.prepare(
    `INSERT INTO workspaces (team_id, name, url, default_channel, added_at)
     VALUES ($team_id, $name, $url, $default_channel, $added_at)`,
  ).run({
    $team_id: row.team_id,
    $name: row.name,
    $url: row.url,
    $default_channel: row.default_channel,
    $added_at: row.added_at,
  });
}

/**
 * Insert when missing or update name/url/default_channel when present.
 *
 * `default_channel: null` is treated as "unspecified" (existing value preserved
 * via `COALESCE`). Use `setDefault(db, team_id, null)` to explicitly clear.
 *
 * `added_at` keeps the existing row's value on update — only the initial insert
 * stamps it. Plan §5.1 (T010) for the rationale.
 */
export function upsert(db: Database, row: WorkspaceRow): void {
  db.prepare(
    `INSERT INTO workspaces (team_id, name, url, default_channel, added_at)
     VALUES ($team_id, $name, $url, $default_channel, $added_at)
     ON CONFLICT(team_id) DO UPDATE SET
       name            = excluded.name,
       url             = excluded.url,
       default_channel = COALESCE(excluded.default_channel, default_channel)`,
  ).run({
    $team_id: row.team_id,
    $name: row.name,
    $url: row.url,
    $default_channel: row.default_channel,
    $added_at: row.added_at,
  });
}

export function get(db: Database, team_id: string): WorkspaceRow | null {
  const row = db
    .query<WorkspaceRow, [string]>("SELECT * FROM workspaces WHERE team_id = ?")
    .get(team_id);
  return row ?? null;
}

export function list(db: Database): WorkspaceRow[] {
  return db.query<WorkspaceRow, []>("SELECT * FROM workspaces ORDER BY added_at ASC").all();
}

export function remove(db: Database, team_id: string): void {
  db.prepare("DELETE FROM workspaces WHERE team_id = ?").run(team_id);
}

export function deleteByTeam(db: Database, team_id: string): void {
  db.prepare("DELETE FROM workspaces WHERE team_id = ?").run(team_id);
}

export function setDefault(db: Database, team_id: string, default_channel: string | null): void {
  db.prepare("UPDATE workspaces SET default_channel = ? WHERE team_id = ?").run(
    default_channel,
    team_id,
  );
}
