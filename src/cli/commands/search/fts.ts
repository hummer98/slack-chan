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

function toPhrase(query: string): string {
  return `"${query.replace(/"/g, '""')}"`;
}

function escapeLikePattern(query: string): string {
  return query.replace(/[\\%_]/g, "\\$&");
}

function codePointLength(s: string): number {
  let n = 0;
  for (const _ of s) n++;
  return n;
}

/**
 * 3 文字未満クエリ向けの LIKE fallback。FTS5 trigram は 3-gram を索引するため
 * 1〜2 文字クエリでは MATCH 不能。bm25 ランキングは効かないので ts DESC で返す。
 * ASCII の case-insensitive のみサポート (ADR-0012)。
 */
function likeSearchFallback(opts: FtsSearchOpts): MessageRow[] {
  const { db, team_id, query, channel_id, user_id, limit } = opts;
  const pattern = `%${escapeLikePattern(query.toLowerCase())}%`;

  const filters: string[] = [];
  const params: Array<string | number> = [team_id, pattern];
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
    "WHERE m.team_id = ? " +
    "  AND m.deleted = 0 " +
    "  AND LOWER(m.text) LIKE ? ESCAPE '\\' " +
    `  ${filters.join(" ")} ` +
    "ORDER BY m.ts DESC " +
    "LIMIT ?";

  try {
    return db.query<MessageRow, (string | number)[]>(sql).all(...params);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new InternalError(`search: like fallback query failed: ${msg}`);
  }
}

/**
 * `<query>` を FTS5 phrase 形式 `"escaped"` に変換し、`messages_fts` を JOIN して
 * messages 行を返す。`m.deleted = 0` を強制して削除済み行を除外。
 *
 * 3 文字未満のクエリは `likeSearchFallback` 経路に流す (ADR-0012)。空文字は [] を返す。
 */
export function searchFts(opts: FtsSearchOpts): MessageRow[] {
  if (opts.query.length === 0) return [];
  if (codePointLength(opts.query) < 3) {
    return likeSearchFallback(opts);
  }

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
