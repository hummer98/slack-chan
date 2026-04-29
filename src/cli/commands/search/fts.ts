import type { Database } from "bun:sqlite";
import type { MessageRow } from "../../../storage/types.ts";
import { InternalError } from "../../errors.ts";

export interface FtsSearchOpts {
  db: Database;
  team_id: string;
  query: string;
  channel_id: string | null;
  user_id: string | null;
  limit: number;
}

/**
 * `<query>` を FTS5 phrase 形式 `"escaped"` に変換し、`messages_fts` を JOIN して
 * messages 行を返す。`m.deleted = 0` を強制して削除済み行を除外。
 */
function toPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

export function searchFts(opts: FtsSearchOpts): MessageRow[] {
  const { db, team_id, query, channel_id, user_id, limit } = opts;
  const phrase = toPhrase(query);

  const filters: string[] = [];
  const params: Array<string | number> = [phrase, team_id];
  if (channel_id !== null) {
    filters.push("AND m.channel_id = ?");
    params.push(channel_id);
  }
  if (user_id !== null) {
    filters.push("AND m.user_id = ?");
    params.push(user_id);
  }
  params.push(limit);

  const sql =
    "SELECT m.* " +
    "FROM messages m " +
    "JOIN messages_fts ON m.rowid = messages_fts.rowid " +
    "WHERE messages_fts MATCH ? " +
    "  AND m.team_id = ? " +
    "  AND m.deleted = 0 " +
    `  ${filters.join(" ")} ` +
    "ORDER BY bm25(messages_fts) ASC, m.ts DESC " +
    "LIMIT ?";

  try {
    return db.query<MessageRow, (string | number)[]>(sql).all(...params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new InternalError(`search: fts query failed: ${msg}`);
  }
}
