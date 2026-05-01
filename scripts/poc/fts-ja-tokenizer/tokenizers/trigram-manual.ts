/**
 * trigram-manual: bigram-manual の 3-gram 版。
 * クエリ長 < 3 は 2-gram fallback (なお実装簡略化のため LIKE fallback で対応)。
 */

import type { Database } from "bun:sqlite";
import type { IndexStats, Message, SearchResult, TokenizerCandidate } from "../types.ts";
import { fts5Phrase, ngrams, nowMs } from "../util.ts";

const N = 3;

function normalize(s: string): string {
  return s.toLowerCase();
}

export const trigramManualCandidate: TokenizerCandidate = {
  name: "trigram-manual",
  notes:
    "文字 3-gram を手動分割。クエリ長 < 3 は LIKE fallback。bigram より index 小さいが recall 低下リスク。",

  available(): boolean {
    return true;
  },

  setup(db: Database, messages: Message[]): IndexStats {
    const start = nowMs();
    db.exec("CREATE TABLE messages (rowid INTEGER PRIMARY KEY, text TEXT)");
    db.exec("CREATE VIRTUAL TABLE fts USING fts5(grams, tokenize='unicode61')");
    const insertMsg = db.prepare("INSERT INTO messages(rowid, text) VALUES (?, ?)");
    const insertFts = db.prepare("INSERT INTO fts(rowid, grams) VALUES (?, ?)");
    db.transaction(() => {
      for (const m of messages) {
        insertMsg.run(m.rowid, m.text);
        insertFts.run(m.rowid, ngrams(normalize(m.text), N));
      }
    })();
    return { indexMs: nowMs() - start, indexedRows: messages.length };
  },

  search(db: Database, query: string): SearchResult {
    const start = nowMs();
    const normalized = normalize(query);
    if ([...normalized].length < N) {
      const rows = db
        .query("SELECT rowid FROM messages WHERE LOWER(text) LIKE ?")
        .all(`%${normalized}%`) as Array<{ rowid: number }>;
      return {
        rowids: rows.map((r) => r.rowid),
        queryMs: nowMs() - start,
        skippedReason: `query too short for ${N}-gram, used LIKE`,
      };
    }
    const grams = ngrams(normalized, N);
    const rows = db
      .query("SELECT rowid FROM fts WHERE fts MATCH ?")
      .all(fts5Phrase(grams)) as Array<{ rowid: number }>;
    return {
      rowids: rows.map((r) => r.rowid),
      queryMs: nowMs() - start,
    };
  },
};
