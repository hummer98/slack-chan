/**
 * 候補実装が共通で使うユーティリティ。
 */

/**
 * FTS5 phrase クエリ用に文字列を escape して `"..."` で囲む。
 * `"` を `""` に escape するだけのシンプルな形式。
 */
export function fts5Phrase(s: string): string {
  return `"${s.replaceAll('"', '""')}"`;
}

/**
 * `text` を `n` 文字 sliding window で n-gram に分解し、空白区切りで返す。
 * 例: bigram("リマインド") → "リマ マイ イン ンド"
 * クエリ長 < n の場合は空文字を返す（呼び出し側で fall-back を判断）。
 */
export function ngrams(text: string, n: number): string {
  const chars = [...text];
  if (chars.length < n) return "";
  const grams: string[] = [];
  for (let i = 0; i + n <= chars.length; i++) {
    grams.push(chars.slice(i, i + n).join(""));
  }
  return grams.join(" ");
}

/**
 * 高精度タイマー (ms 単位 float)。
 */
export function nowMs(): number {
  return performance.now();
}

/**
 * 配列の差集合 |A - B| を計算（precision/recall 用）。
 */
export function setDiff<T>(a: T[], b: T[]): T[] {
  const bs = new Set(b);
  return a.filter((x) => !bs.has(x));
}

export function setIntersect<T>(a: T[], b: T[]): T[] {
  const bs = new Set(b);
  return a.filter((x) => bs.has(x));
}
