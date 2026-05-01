/**
 * tinysegmenter: 500-line 純 JS の形態素解析器（辞書なし）。
 *
 * - INSERT 時: text を segment 化 → 半角スペース区切りで unicode61 に流す
 * - 検索時: クエリも segment 化して MATCH（複数 token の AND 検索）
 * - 形態素境界が一致しないと部分一致が落ちるので、AND 検索でゆるく取る
 *
 * vendor source: ./tinysegmenter-vendor.js (BSD, code4fukui/TinySegmenter @ edc44b2)
 */

import type { Database } from "bun:sqlite";
import type { IndexStats, Message, SearchResult, TokenizerCandidate } from "../types.ts";
import { fts5Phrase, nowMs } from "../util.ts";
// @ts-expect-error -- vendored JS, no type declarations
import { TinySegmenter } from "./tinysegmenter-vendor.js";

function segment(text: string): string[] {
  const segs = (TinySegmenter.segment(text) as string[])
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  return segs;
}

function joinSegments(text: string): string {
  return segment(text.toLowerCase()).join(" ");
}

export const tinysegmenterCandidate: TokenizerCandidate = {
  name: "tinysegmenter",
  notes:
    "500行の純 JS 形態素解析器（vendored, BSD）。辞書なし。形態素境界に依存するため部分一致 recall は不安定。",

  available(): boolean {
    return true;
  },

  setup(db: Database, messages: Message[]): IndexStats {
    const start = nowMs();
    db.exec("CREATE TABLE messages (rowid INTEGER PRIMARY KEY, text TEXT)");
    db.exec("CREATE VIRTUAL TABLE fts USING fts5(segments, tokenize='unicode61')");
    const insertMsg = db.prepare("INSERT INTO messages(rowid, text) VALUES (?, ?)");
    const insertFts = db.prepare("INSERT INTO fts(rowid, segments) VALUES (?, ?)");
    db.transaction(() => {
      for (const m of messages) {
        insertMsg.run(m.rowid, m.text);
        insertFts.run(m.rowid, joinSegments(m.text));
      }
    })();
    return { indexMs: nowMs() - start, indexedRows: messages.length };
  },

  search(db: Database, query: string): SearchResult {
    const start = nowMs();
    const tokens = segment(query.toLowerCase());
    if (tokens.length === 0) {
      return { rowids: [], queryMs: nowMs() - start, skippedReason: "empty after segmentation" };
    }
    // 全 token を AND 検索 (連続 phrase だと境界一致厳しすぎ)
    const fts5Query = tokens.map((t) => fts5Phrase(t)).join(" AND ");
    const rows = db
      .query("SELECT rowid FROM fts WHERE fts MATCH ?")
      .all(fts5Query) as Array<{ rowid: number }>;
    return {
      rowids: rows.map((r) => r.rowid),
      queryMs: nowMs() - start,
    };
  },
};
