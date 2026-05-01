/**
 * PoC runner と各 tokenizer 候補の共通型定義。
 */

import type { Database } from "bun:sqlite";

export interface Message {
  rowid: number;
  text: string;
}

export interface IndexStats {
  indexMs: number;
  indexedRows: number;
}

export interface SearchResult {
  rowids: number[];
  queryMs: number;
  /** クエリが tokenizer の制約で実行不能だった場合の理由 (例: trigram で 2 文字クエリ) */
  skippedReason?: string;
}

/**
 * 各 tokenizer 候補が実装する共通インタフェース。
 * runner は available → setup → search を順に呼ぶ。
 */
export interface TokenizerCandidate {
  /** ADR / レポートに出る短い名前 (`unicode61`, `trigram-builtin` 等) */
  readonly name: string;
  /** ADR `Comparison Matrix` の Notes 列に転記する短文 */
  readonly notes: string;
  /** builtin / icu / 形態素解析の事前可否判定。NG なら runner はその候補を skip。 */
  available(probeDb: Database): boolean | Promise<boolean>;
  /** 一時 db に index を構築。経過時間を返す。 */
  setup(db: Database, messages: Message[]): IndexStats | Promise<IndexStats>;
  /** クエリを実行して hit rowids を返す。経過時間を返す。 */
  search(db: Database, query: string): SearchResult | Promise<SearchResult>;
}
