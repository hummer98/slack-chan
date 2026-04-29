import type { Database } from "bun:sqlite";
import type { UserRow } from "../types.ts";

export function upsert(db: Database, row: UserRow): void {
  db.prepare(
    `INSERT INTO users (
       team_id, user_id, name, real_name, email, profile_json, fetched_at
     ) VALUES (
       $team_id, $user_id, $name, $real_name, $email, $profile_json, $fetched_at
     )
     ON CONFLICT(team_id, user_id) DO UPDATE SET
       name         = excluded.name,
       real_name    = excluded.real_name,
       email        = excluded.email,
       profile_json = excluded.profile_json,
       fetched_at   = excluded.fetched_at`,
  ).run({
    $team_id: row.team_id,
    $user_id: row.user_id,
    $name: row.name,
    $real_name: row.real_name,
    $email: row.email,
    $profile_json: row.profile_json,
    $fetched_at: row.fetched_at,
  });
}

export function deleteByTeam(db: Database, team_id: string): void {
  db.prepare("DELETE FROM users WHERE team_id = ?").run(team_id);
}

export function get(db: Database, team_id: string, user_id: string): UserRow | null {
  const row = db
    .query<UserRow, [string, string]>("SELECT * FROM users WHERE team_id = ? AND user_id = ?")
    .get(team_id, user_id);
  return row ?? null;
}
