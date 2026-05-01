/**
 * unicode61: FTS5 のデフォルト tokenizer。CJK 連続文字を 1 トークンとして扱うため、
 * 日本語の部分一致がほぼ落ちる。本 PoC のベースライン。
 */

import type { Database } from "bun:sqlite";
import type { IndexStats, Message, SearchResult, TokenizerCandidate } from "../types.ts";
import { fts5Phrase, nowMs } from "../util.ts";

export const unicode61Candidate: TokenizerCandidate = {
  name: "unicode61",
  notes: "FTS5 default. CJK連続文字を 1 トークン化するため日本語部分一致は基本落ちる。",

  available(): boolean {
    return true;
  },

  setup(db: Database, messages: Message[]): IndexStats {
    const start = nowMs();
    db.exec(
      "CREATE VIRTUAL TABLE fts USING fts5(text, tokenize='unicode61 remove_diacritics 2')",
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
