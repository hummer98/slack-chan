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

export function list(db: Database): WorkspaceRow[] {
  return db.query<WorkspaceRow, []>("SELECT * FROM workspaces ORDER BY added_at ASC").all();
}

export function remove(db: Database, team_id: string): void {
  db.prepare("DELETE FROM workspaces WHERE team_id = ?").run(team_id);
}

export function setDefault(db: Database, team_id: string, default_channel: string | null): void {
  db.prepare("UPDATE workspaces SET default_channel = ? WHERE team_id = ?").run(
    default_channel,
    team_id,
  );
}
