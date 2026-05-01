/**
 * bigram-manual: text を文字 2-gram に手動分割し、unicode61 の FTS5 に流し込む。
 * tokenizer 側ではなく index 側の文字列を加工する方式。
 *
 * - INSERT 時: text → "リマ マイ イン ンド" のような 2-gram 列に変換して FTS に投入
 * - 検索時: クエリも同じ規則で 2-gram 化して MATCH
 * - クエリ長 < 2 の場合は LIKE フォールバック
 *
 * case-sensitivity: クエリ・index 両方で `toLowerCase()` してから 2-gram 化することで
 * unicode61 (default で casefold) と整合させる。
 */

import type { Database } from "bun:sqlite";
import type { IndexStats, Message, SearchResult, TokenizerCandidate } from "../types.ts";
import { fts5Phrase, ngrams, nowMs } from "../util.ts";

const N = 2;

function normalize(s: string): string {
  return s.toLowerCase();
}

export const bigramManualCandidate: TokenizerCandidate = {
  name: "bigram-manual",
  notes:
    "文字 2-gram を手動分割し unicode61 に流し込む。クエリ長 < 2 は LIKE fallback。",

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
      // クエリ短すぎ → LIKE fallback
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
    // 各 gram を AND 検索 (FTS5 phrase + 連続性は問わない実装にすると recall が上がる)
    // ここではクエリ全体を phrase として MATCH することで「順序保持の n-gram 一致」を要求
    const rows = db
      .query("SELECT rowid FROM fts WHERE fts MATCH ?")
      .all(fts5Phrase(grams)) as Array<{ rowid: number }>;
    return {
      rowids: rows.map((r) => r.rowid),
      queryMs: nowMs() - start,
    };
  },
};
