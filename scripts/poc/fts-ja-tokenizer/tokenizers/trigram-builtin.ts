/**
 * trigram-builtin: SQLite 3.34+ の builtin trigram tokenizer。
 *
 * - virtual table 定義に `tokenize='trigram'` を書くだけ
 * - INSERT/SELECT のテキストはそのままで OK (SQLite が内部で gram 化)
 * - case_sensitive 0 が default → 大文字小文字を吸収
 * - 3 文字未満のクエリは MATCH 不能 → LIKE fallback
 */

import type { Database } from "bun:sqlite";
import type { IndexStats, Message, SearchResult, TokenizerCandidate } from "../types.ts";
import { fts5Phrase, nowMs } from "../util.ts";

export const trigramBuiltinCandidate: TokenizerCandidate = {
  name: "trigram-builtin",
  notes: "FTS5 builtin trigram (SQLite 3.34+)。実装複雑度・配布影響ともに最小。",

  available(probeDb: Database): boolean {
    try {
      probeDb.exec(
        "CREATE VIRTUAL TABLE __probe USING fts5(x, tokenize='trigram')",
      );
      probeDb.exec("DROP TABLE __probe");
      return true;
    } catch {
      return false;
    }
  },

  setup(db: Database, messages: Message[]): IndexStats {
    const start = nowMs();
    db.exec("CREATE TABLE messages (rowid INTEGER PRIMARY KEY, text TEXT)");
    db.exec(
      "CREATE VIRTUAL TABLE fts USING fts5(text, content='messages', content_rowid='rowid', tokenize='trigram case_sensitive 0')",
    );
    const insert = db.prepare("INSERT INTO messages(rowid, text) VALUES (?, ?)");
    db.transaction(() => {
      for (const m of messages) insert.run(m.rowid, m.text);
    })();
    // external content の場合 fts table の rebuild が必要
    db.exec("INSERT INTO fts(fts) VALUES ('rebuild')");
    return { indexMs: nowMs() - start, indexedRows: messages.length };
  },

  search(db: Database, query: string): SearchResult {
    const start = nowMs();
    if ([...query].length < 3) {
      // trigram は 3 文字未満を扱えない → LIKE fallback (case-insensitive を保つため LOWER)
      const rows = db
        .query("SELECT rowid FROM messages WHERE LOWER(text) LIKE ?")
        .all(`%${query.toLowerCase()}%`) as Array<{ rowid: number }>;
      return {
        rowids: rows.map((r) => r.rowid),
        queryMs: nowMs() - start,
        skippedReason: "query < 3 chars: trigram cannot match, used LIKE",
      };
    }
    const rows = db
      .query("SELECT rowid FROM fts WHERE fts MATCH ?")
      .all(fts5Phrase(query)) as Array<{ rowid: number }>;
    return {
      rowids: rows.map((r) => r.rowid),
      queryMs: nowMs() - start,
    };
  },
};
