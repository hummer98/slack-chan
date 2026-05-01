/**
 * icu: SQLite ICU tokenizer (`tokenize='icu ja_JP'`)。
 *
 * bun:sqlite (Bun 同梱の SQLite) は標準で ICU 拡張をリンクしていないため、
 * available() は基本的に false を返す。runner はこの候補をスキップする。
 *
 * 詳細: ADR-0012 §Rejected Alternatives + ADR-0001 (bun:sqlite 採用) 参照。
 */

import type { Database } from "bun:sqlite";
import type { IndexStats, Message, SearchResult, TokenizerCandidate } from "../types.ts";
import { fts5Phrase, nowMs } from "../util.ts";

export const icuCandidate: TokenizerCandidate = {
  name: "icu",
  notes: "SQLite ICU tokenizer。bun:sqlite に ICU 拡張がないため基本不採用。",

  available(probeDb: Database): boolean {
    try {
      probeDb.exec("CREATE VIRTUAL TABLE __icu_probe USING fts5(x, tokenize='icu ja_JP')");
      probeDb.exec("DROP TABLE __icu_probe");
      return true;
    } catch {
      return false;
    }
  },

  setup(db: Database, messages: Message[]): IndexStats {
    const start = nowMs();
    db.exec(
      "CREATE VIRTUAL TABLE fts USING fts5(text, tokenize='icu ja_JP')",
    );
    const insert = db.prepare("INSERT INTO fts(rowid, text) VALUES (?, ?)");
    db.transaction(() => {
      for (const m of messages) insert.run(m.rowid, m.text);
    })();
    return { indexMs: nowMs() - start, indexedRows: messages.length };
  },

  search(db: Database, query: string): SearchResult {
    const start = nowMs();
    const rows = db
      .query("SELECT rowid FROM fts WHERE fts MATCH ?")
      .all(fts5Phrase(query)) as Array<{ rowid: number }>;
    return {
      rowids: rows.map((r) => r.rowid),
      queryMs: nowMs() - start,
    };
  },
};
