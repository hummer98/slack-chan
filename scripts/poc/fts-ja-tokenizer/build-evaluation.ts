/**
 * cache.db (read-only) から evaluation.json を生成する。
 *
 * 各クエリについて `text LIKE '%query%'` で expected hits を確定。
 * SQLite LIKE は ASCII case-insensitive (Unicode は case-sensitive)。
 * これを評価の正解値とする。
 *
 * NOTE: 出力 evaluation.json は PII (実 Slack メッセージ rowid + テキスト) を
 * 含むので scripts/poc/.gitignore で除外される。絶対に commit しない。
 */

import { Database } from "bun:sqlite";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

interface EvaluationEntry {
  query: string;
  expectedRowIds: number[];
  expectedTexts: string[]; // デバッグ用 — 目視確認に使う
}

const QUERIES = ["リマインド", "集う会", "宿泊費", "KDG", "test"];

function main(): void {
  const dbPath = resolve(homedir(), ".local/share/slack-chan/cache.db");
  // read-only で開く
  const db = new Database(`file:${dbPath}?mode=ro`, { readonly: true });

  const entries: EvaluationEntry[] = [];
  for (const query of QUERIES) {
    const rows = db
      .query("SELECT rowid, text FROM messages WHERE text LIKE ? ORDER BY rowid")
      .all(`%${query}%`) as Array<{ rowid: number; text: string }>;
    entries.push({
      query,
      expectedRowIds: rows.map((r) => r.rowid),
      expectedTexts: rows.map((r) => r.text),
    });
  }

  const totalRows = (db.query("SELECT COUNT(*) AS n FROM messages").get() as { n: number }).n;

  console.log(`messages: ${totalRows} rows`);
  for (const e of entries) {
    console.log(`  "${e.query}": ${e.expectedRowIds.length} hits → ${e.expectedRowIds.join(",")}`);
  }

  db.close();

  const outPath = resolve(import.meta.dir, "evaluation.json");
  writeFileSync(
    outPath,
    `${JSON.stringify(
      {
        totalMessages: totalRows,
        generatedAt: new Date().toISOString(),
        note: "expected hits based on `text LIKE '%query%'` (ASCII case-insensitive). DO NOT COMMIT — contains PII.",
        entries,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`\nWrote: ${outPath}`);
}

main();
