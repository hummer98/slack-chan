#!/usr/bin/env bun
/**
 * Walk `tests/fixtures/**\/*.json`, apply the redact rules from
 * `src/testing/fixture-redact.ts`, and either rewrite each file in place
 * (default) or fail with a diff (`--check`, used in pre-commit / CI).
 *
 * Usage:
 *   bun run redact-fixtures                  # in-place
 *   bun run redact-fixtures -- --check       # exit 1 on drift
 *   bun run redact-fixtures -- path/to/file.json
 *   bun run redact-fixtures -- --check path/to/file.json
 */
import { readFileSync, writeFileSync } from "node:fs";
import { redactFixture } from "../src/testing/fixture-redact.ts";
import type { SlackFixtureRaw } from "../src/testing/fixture-types.ts";

const FIXTURE_ROOT = "tests/fixtures";

function parseArgs(argv: string[]): { check: boolean; paths: string[] } {
  const check = argv.includes("--check");
  const paths = argv.filter((a) => !a.startsWith("--"));
  return { check, paths };
}

async function listFixtureFiles(): Promise<string[]> {
  const glob = new Bun.Glob("**/*.json");
  const out: string[] = [];
  for await (const rel of glob.scan({ cwd: FIXTURE_ROOT })) {
    out.push(`${FIXTURE_ROOT}/${rel}`);
  }
  return out.sort();
}

function readJson(path: string): Record<string, unknown> {
  const text = readFileSync(path, "utf8");
  return JSON.parse(text) as Record<string, unknown>;
}

function asRaw(input: Record<string, unknown>): SlackFixtureRaw {
  return {
    method: String(input.method ?? ""),
    params: (input.params as Record<string, unknown> | null) ?? null,
    status: typeof input.status === "number" ? input.status : 200,
    data: (input.data as Record<string, unknown>) ?? {},
    recorded_at: String(input.recorded_at ?? ""),
    redacted: false,
  };
}

function serialize(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function unifiedDiff(orig: string, next: string, label: string): string {
  const a = orig.split("\n");
  const b = next.split("\n");
  const out: string[] = [`--- ${label} (current)`, `+++ ${label} (redacted)`];
  const max = Math.max(a.length, b.length);
  for (let i = 0; i < max; i++) {
    if (a[i] === b[i]) continue;
    if (i < a.length) out.push(`- ${a[i]}`);
    if (i < b.length) out.push(`+ ${b[i]}`);
  }
  return out.join("\n");
}

interface Result {
  path: string;
  current: string;
  next: string;
  changed: boolean;
}

function processOne(path: string): Result {
  const current = readFileSync(path, "utf8");
  const parsed = readJson(path);
  const redacted = redactFixture(asRaw(parsed));
  const next = serialize(redacted);
  return { path, current, next, changed: current !== next };
}

async function main(): Promise<number> {
  const { check, paths } = parseArgs(Bun.argv.slice(2));
  const targets = paths.length > 0 ? paths : await listFixtureFiles();

  if (targets.length === 0) {
    console.error(`[redact-fixtures] no fixture files found under ${FIXTURE_ROOT}/`);
    return 0;
  }

  let driftCount = 0;
  for (const path of targets) {
    const result = processOne(path);
    if (!result.changed) continue;
    driftCount += 1;
    if (check) {
      console.error(unifiedDiff(result.current, result.next, result.path));
    } else {
      writeFileSync(result.path, result.next, "utf8");
      console.error(`[redact-fixtures] redacted ${result.path}`);
    }
  }

  if (check && driftCount > 0) {
    console.error(`[redact-fixtures] ${driftCount} file(s) need redaction. Run \`bun run redact-fixtures\`.`);
    return 1;
  }
  return 0;
}

const code = await main();
process.exit(code);
