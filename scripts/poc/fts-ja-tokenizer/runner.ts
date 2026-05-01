/**
 * PoC runner: 全候補で同じ evaluation.json を流して比較表を出力する。
 *
 * 使い方:
 *   bun run scripts/poc/fts-ja-tokenizer/runner.ts                # original-40 (精度評価)
 *   bun run scripts/poc/fts-ja-tokenizer/runner.ts --repeat 25    # repeat-1000 (速度評価)
 *
 * 出力:
 *   stdout: 比較表 (markdown)
 *   results/<候補>.original-40.json   または
 *   results/<候補>.repeat-1000.json
 *
 * 各 results JSON に `dataset: "original-40" | "repeat-1000"` を必ず含める。
 * 精度数値は original-40、速度数値は repeat-1000 を ADR で使い分けるため。
 */

import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

import { bigramManualCandidate } from "./tokenizers/bigram-manual.ts";
import { icuCandidate } from "./tokenizers/icu.ts";
import { tinysegmenterCandidate } from "./tokenizers/tinysegmenter.ts";
import { trigramBuiltinCandidate } from "./tokenizers/trigram-builtin.ts";
import { trigramManualCandidate } from "./tokenizers/trigram-manual.ts";
import { unicode61Candidate } from "./tokenizers/unicode61.ts";
import type { Message, TokenizerCandidate } from "./types.ts";
import { setIntersect } from "./util.ts";

interface EvalEntry {
  query: string;
  expectedRowIds: number[];
  expectedTexts?: string[];
}
interface EvalFile {
  totalMessages: number;
  generatedAt: string;
  note: string;
  entries: EvalEntry[];
}

interface PerQueryMetric {
  query: string;
  expected: number;
  hits: number;
  truePositives: number;
  precision: number;
  recall: number;
  f1: number;
  queryMs: number;
  hitRowIds: number[];
  skippedReason?: string;
}

interface CandidateResult {
  candidate: string;
  notes: string;
  dataset: "original-40" | "repeat-1000";
  available: boolean;
  unavailableReason?: string;
  indexMs: number;
  indexedRows: number;
  perQuery: PerQueryMetric[];
  avgQueryMs: number;
  macroPrecision: number;
  macroRecall: number;
  macroF1: number;
  testedAt: string;
  evaluationGeneratedAt: string;
}

const CANDIDATES: TokenizerCandidate[] = [
  unicode61Candidate,
  bigramManualCandidate,
  trigramManualCandidate,
  trigramBuiltinCandidate,
  tinysegmenterCandidate,
  icuCandidate,
];

function loadEvaluation(): EvalFile {
  const path = resolve(import.meta.dir, "evaluation.json");
  if (!existsSync(path)) {
    throw new Error(
      `evaluation.json not found. Run: bun run ${resolve(import.meta.dir, "build-evaluation.ts")}`,
    );
  }
  return JSON.parse(readFileSync(path, "utf-8"));
}

function loadMessages(repeat: number): { messages: Message[]; original: number } {
  const dbPath = resolve(homedir(), ".local/share/slack-chan/cache.db");
  const db = new Database(`file:${dbPath}?mode=ro`, { readonly: true });
  const original = db.query("SELECT rowid, text FROM messages ORDER BY rowid").all() as Array<{
    rowid: number;
    text: string;
  }>;
  db.close();
  if (repeat <= 1) {
    return { messages: original, original: original.length };
  }
  // 速度評価用: 同じ text を複製、rowid を新規採番。
  const messages: Message[] = [];
  let nextRowid = 1;
  for (let r = 0; r < repeat; r++) {
    for (const o of original) {
      messages.push({ rowid: nextRowid++, text: o.text });
    }
  }
  return { messages, original: original.length };
}

function metric(expected: number[], hits: number[]): { p: number; r: number; f1: number; tp: number } {
  const tp = setIntersect(hits, expected).length;
  if (expected.length === 0 && hits.length === 0) {
    // 「期待 0 件 / hit 0 件」は完全一致。
    return { p: 1, r: 1, f1: 1, tp: 0 };
  }
  const p = hits.length === 0 ? 0 : tp / hits.length;
  const r = expected.length === 0 ? 0 : tp / expected.length;
  const f1 = p + r === 0 ? 0 : (2 * p * r) / (p + r);
  return { p, r, f1, tp };
}

async function runCandidate(
  c: TokenizerCandidate,
  messages: Message[],
  evalFile: EvalFile,
  dataset: CandidateResult["dataset"],
): Promise<CandidateResult> {
  const tmp = join(tmpdir(), `slackchan-poc-fts-${c.name}-${Date.now()}.db`);
  const probeDb = new Database(":memory:");
  let availResult: boolean;
  try {
    availResult = (await c.available(probeDb)) === true;
  } finally {
    probeDb.close();
  }

  const baseResult: CandidateResult = {
    candidate: c.name,
    notes: c.notes,
    dataset,
    available: availResult,
    indexMs: 0,
    indexedRows: 0,
    perQuery: [],
    avgQueryMs: 0,
    macroPrecision: 0,
    macroRecall: 0,
    macroF1: 0,
    testedAt: new Date().toISOString(),
    evaluationGeneratedAt: evalFile.generatedAt,
  };

  if (!availResult) {
    return {
      ...baseResult,
      unavailableReason: `${c.name}: available()=false (extension/version not supported)`,
    };
  }

  const db = new Database(tmp);
  try {
    const indexStats = await c.setup(db, messages);
    const perQuery: PerQueryMetric[] = [];
    for (const e of evalFile.entries) {
      const sr = await c.search(db, e.query);
      const hits = sr.rowids;
      // 精度評価は常に「original-40 の rowid 集合」を expected に使う。
      // repeat-1000 でも expected は同じだが、index には複製分が含まれるため
      // hits に元 rowid（1..40）以外も混ざる。これは「精度は original で測る」原則に従い
      // dataset=='original-40' でのみ評価メトリクスを意味あるものとして扱う。
      const m = metric(e.expectedRowIds, hits);
      perQuery.push({
        query: e.query,
        expected: e.expectedRowIds.length,
        hits: hits.length,
        truePositives: m.tp,
        precision: m.p,
        recall: m.r,
        f1: m.f1,
        queryMs: sr.queryMs,
        hitRowIds: hits,
        skippedReason: sr.skippedReason,
      });
    }
    const avgQueryMs = perQuery.reduce((a, b) => a + b.queryMs, 0) / perQuery.length;
    const macroPrecision = perQuery.reduce((a, b) => a + b.precision, 0) / perQuery.length;
    const macroRecall = perQuery.reduce((a, b) => a + b.recall, 0) / perQuery.length;
    const macroF1 = perQuery.reduce((a, b) => a + b.f1, 0) / perQuery.length;
    return {
      ...baseResult,
      indexMs: indexStats.indexMs,
      indexedRows: indexStats.indexedRows,
      perQuery,
      avgQueryMs,
      macroPrecision,
      macroRecall,
      macroF1,
    };
  } finally {
    db.close();
    try {
      rmSync(tmp);
      rmSync(`${tmp}-shm`, { force: true });
      rmSync(`${tmp}-wal`, { force: true });
    } catch {
      // ignore
    }
  }
}

function fmtNum(n: number, digits = 2): string {
  return Number.isFinite(n) ? n.toFixed(digits) : "n/a";
}

function printTable(rows: CandidateResult[]): void {
  const header = "| Tokenizer       | Available | Indexed | Index ms | Avg Query ms | Precision | Recall | F1   |";
  const sep = "|-----------------|-----------|---------|----------|--------------|-----------|--------|------|";
  console.log(header);
  console.log(sep);
  for (const r of rows) {
    const avail = r.available ? "yes" : "no";
    if (!r.available) {
      console.log(`| ${r.candidate.padEnd(15)} | ${avail.padEnd(9)} |       — |        — |            — |         — |      — |    — |`);
      continue;
    }
    console.log(
      `| ${r.candidate.padEnd(15)} | ${avail.padEnd(9)} | ${String(r.indexedRows).padStart(7)} | ${fmtNum(r.indexMs, 1).padStart(8)} | ${fmtNum(r.avgQueryMs, 2).padStart(12)} | ${fmtNum(r.macroPrecision, 2).padStart(9)} | ${fmtNum(r.macroRecall, 2).padStart(6)} | ${fmtNum(r.macroF1, 2).padStart(4)} |`,
    );
  }
}

async function main(): Promise<void> {
  const { values } = parseArgs({
    args: process.argv.slice(2),
    options: {
      repeat: { type: "string", default: "1" },
      only: { type: "string" }, // comma-separated candidate names
    },
  });
  const repeat = Number.parseInt(String(values.repeat), 10);
  if (!Number.isFinite(repeat) || repeat < 1) {
    throw new Error(`Invalid --repeat: ${values.repeat}`);
  }
  const dataset: CandidateResult["dataset"] = repeat === 1 ? "original-40" : "repeat-1000";
  const onlyFilter = values.only ? new Set(String(values.only).split(",")) : null;

  const evalFile = loadEvaluation();
  const { messages, original } = loadMessages(repeat);

  console.log(
    `# PoC runner — dataset=${dataset} (messages=${messages.length}, original=${original}, repeat=${repeat})\n`,
  );

  const resultsDir = resolve(import.meta.dir, "results");
  mkdirSync(resultsDir, { recursive: true });

  const results: CandidateResult[] = [];
  for (const c of CANDIDATES) {
    if (onlyFilter && !onlyFilter.has(c.name)) continue;
    const r = await runCandidate(c, messages, evalFile, dataset);
    results.push(r);
    const outPath = join(resultsDir, `${c.name}.${dataset}.json`);
    writeFileSync(outPath, `${JSON.stringify(r, null, 2)}\n`);
  }

  printTable(results);
  console.log(
    `\n  - dataset=${dataset}: precision/recall は ${dataset === "original-40" ? "意味のある数値" : "参考値（rowid が複製のため original でのみ評価する原則に従い、speed 用)"}`,
  );
  console.log(`  - results: ${resultsDir}`);

  // 簡易: per-query 詳細を最後に表示（デバッグ用）
  console.log("\n## Per-query details");
  for (const r of results) {
    if (!r.available) continue;
    console.log(`\n### ${r.candidate}`);
    console.log("| query | expected | hits | tp | P | R | F1 | qms | note |");
    console.log("|-------|----------|------|----|---|---|----|-----|------|");
    for (const q of r.perQuery) {
      console.log(
        `| ${q.query} | ${q.expected} | ${q.hits} | ${q.truePositives} | ${fmtNum(q.precision)} | ${fmtNum(q.recall)} | ${fmtNum(q.f1)} | ${fmtNum(q.queryMs, 2)} | ${q.skippedReason ?? ""} |`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
