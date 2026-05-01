/**
 * bun:sqlite の能力 probe。
 *
 * - SQLite version
 * - FTS5 builtin trigram tokenizer の可否
 * - ICU 拡張の可否
 *
 * 結果は stdout (人間可読) と <OUTPUT_DIR>/probe.json に書き出す。
 * Implementer は ADR-0012 の Context にこの結果を転記する。
 */

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { argv } from "node:process";

interface ProbeResult {
  sqliteVersion: string;
  fts5Available: boolean;
  trigramBuiltinAvailable: boolean;
  trigramBuiltinError?: string;
  icuAvailable: boolean;
  icuError?: string;
  testedAt: string;
}

function probeSqliteVersion(db: Database): string {
  const row = db.query("SELECT sqlite_version() AS v").get() as { v: string };
  return row.v;
}

function probeFts5(db: Database): boolean {
  try {
    db.exec("CREATE VIRTUAL TABLE __fts5_probe USING fts5(x)");
    db.exec("DROP TABLE __fts5_probe");
    return true;
  } catch {
    return false;
  }
}

function probeTrigramBuiltin(db: Database): { ok: boolean; error?: string } {
  try {
    db.exec("CREATE VIRTUAL TABLE __trigram_probe USING fts5(x, tokenize='trigram')");
    db.exec("INSERT INTO __trigram_probe(x) VALUES ('テスト文字列abc')");
    // trigram は 3 文字以上のクエリのみ扱える。3 文字 + ASCII 3 文字でそれぞれ検証。
    const cjk = db
      .query("SELECT rowid FROM __trigram_probe WHERE __trigram_probe MATCH ?")
      .all('"テスト"') as Array<{ rowid: number }>;
    const ascii = db
      .query("SELECT rowid FROM __trigram_probe WHERE __trigram_probe MATCH ?")
      .all('"abc"') as Array<{ rowid: number }>;
    db.exec("DROP TABLE __trigram_probe");
    if (cjk.length !== 1 || ascii.length !== 1) {
      return {
        ok: false,
        error: `MATCH returned cjk=${cjk.length}, ascii=${ascii.length} (expected 1 each)`,
      };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function probeIcu(db: Database): { ok: boolean; error?: string } {
  try {
    db.exec("CREATE VIRTUAL TABLE __icu_probe USING fts5(x, tokenize='icu ja_JP')");
    db.exec("DROP TABLE __icu_probe");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

function main(): void {
  const outPath = argv[2] ?? "";
  const db = new Database(":memory:");

  const sqliteVersion = probeSqliteVersion(db);
  const fts5Available = probeFts5(db);
  const trigram = probeTrigramBuiltin(db);
  const icu = probeIcu(db);

  const result: ProbeResult = {
    sqliteVersion,
    fts5Available,
    trigramBuiltinAvailable: trigram.ok,
    trigramBuiltinError: trigram.error,
    icuAvailable: icu.ok,
    icuError: icu.error,
    testedAt: new Date().toISOString(),
  };

  db.close();

  console.log("=== bun:sqlite probe ===");
  console.log(`SQLite version       : ${result.sqliteVersion}`);
  console.log(`FTS5 available       : ${result.fts5Available ? "YES" : "NO"}`);
  console.log(
    `trigram builtin      : ${result.trigramBuiltinAvailable ? "YES" : "NO"}${result.trigramBuiltinError ? ` (${result.trigramBuiltinError})` : ""}`,
  );
  console.log(
    `ICU tokenizer        : ${result.icuAvailable ? "YES" : "NO"}${result.icuError ? ` (${result.icuError})` : ""}`,
  );

  if (outPath) {
    const abs = resolve(outPath);
    mkdirSync(dirname(abs), { recursive: true });
    writeFileSync(abs, `${JSON.stringify(result, null, 2)}\n`);
    console.log(`\nWrote: ${abs}`);
  }
}

main();
