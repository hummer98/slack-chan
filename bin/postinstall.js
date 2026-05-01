#!/usr/bin/env node
// npm postinstall: GitHub Release から platform 別の bun-compile native binary を
// DL し、SHA256 検証して bin/slack-chan-native に保存。続けて Claude Code の
// plugin / skill を user scope で登録する (claude が PATH にあれば)。
//
// すべて best-effort: 失敗しても npm install は失敗扱いにしない (process.exit(0))。
// ローカル開発 (node_modules 配下でない / version=0.0.0) ではスキップする。
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, "..", "package.json"), "utf8"));
const VERSION = pkg.version;

const log = (m) => console.log(`slack-chan: ${m}`);
const warn = (m) => console.warn(`slack-chan: ${m}`);

const skip = (reason) => {
  log(`postinstall skipped (${reason})`);
  process.exit(0);
};

if (process.env.SLACK_CHAN_SKIP_POSTINSTALL === "1") skip("SLACK_CHAN_SKIP_POSTINSTALL=1");
if (!here.includes(`${sep}node_modules${sep}`)) skip("not running under node_modules — local dev");
if (VERSION === "0.0.0") skip("version=0.0.0 — pre-release");
if (process.platform === "win32") {
  warn("Windows は未対応です。WSL2 を使うか Homebrew (mac/linux) で導入してください。");
  process.exit(0);
}
if (process.platform !== "darwin" && process.platform !== "linux") {
  warn(`未対応プラットフォーム: ${process.platform}`);
  process.exit(0);
}

const arch = process.arch === "arm64" ? "arm64" : "x64";
const target = `bun-${process.platform}-${arch}`;
const fileName = `slack-chan-${VERSION}-${target}`;
const releaseBase = `https://github.com/hummer98/slack-chan/releases/download/v${VERSION}`;
const binUrl = `${releaseBase}/${fileName}`;
const sumsUrl = `${releaseBase}/SHA256SUMS`;

const binPath = join(here, "slack-chan-native");
const tmpPath = `${binPath}.tmp`;

async function fetchBuf(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} on ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function downloadAndVerify() {
  log(`downloading ${fileName} from GitHub Release v${VERSION}`);
  const [binBuf, sumsBuf] = await Promise.all([fetchBuf(binUrl), fetchBuf(sumsUrl)]);
  const sumsLine = sumsBuf
    .toString("utf8")
    .split("\n")
    .find((l) => l.includes(fileName));
  if (!sumsLine) throw new Error(`${fileName} not present in SHA256SUMS`);
  const expected = sumsLine.trim().split(/\s+/)[0];
  const actual = createHash("sha256").update(binBuf).digest("hex");
  if (expected !== actual) throw new Error(`SHA256 mismatch: expected ${expected}, got ${actual}`);
  writeFileSync(tmpPath, binBuf);
  renameSync(tmpPath, binPath);
  chmodSync(binPath, 0o755);
  log(`installed native binary at ${binPath}`);
}

function tryClaudeRegister() {
  try {
    execFileSync("which", ["claude"], { stdio: "ignore" });
  } catch {
    warn("`claude` が PATH に見つかりません。Claude Code 内で次を実行してください:");
    warn("  /plugin marketplace add hummer98/slack-chan");
    warn("  /plugin install slack-chan@slack-chan-marketplace");
    return;
  }
  log("Claude Code plugin を登録します");
  try {
    execFileSync("claude", ["plugin", "marketplace", "add", "hummer98/slack-chan"], { stdio: "inherit" });
  } catch (e) {
    // 既登録の場合はここに来ることがある — 致命的ではない
    warn(`marketplace add: ${e instanceof Error ? e.message : String(e)} (already registered の可能性あり)`);
  }
  try {
    execFileSync(
      "claude",
      ["plugin", "install", "slack-chan@slack-chan-marketplace", "--scope", "user"],
      { stdio: "inherit" },
    );
  } catch (e) {
    warn(`plugin install: ${e instanceof Error ? e.message : String(e)} (already installed の可能性あり)`);
  }
}

(async () => {
  try {
    await downloadAndVerify();
  } catch (e) {
    if (existsSync(tmpPath)) {
      try {
        unlinkSync(tmpPath);
      } catch {}
    }
    warn(`native binary の取得に失敗しました: ${e instanceof Error ? e.message : String(e)}`);
    warn("`slack-chan` コマンドはこのままでは動きません。次のいずれかで復旧してください:");
    warn(`  - 再実行:    npm rebuild @hummer98/slack-chan`);
    warn(`  - 手動 DL:   ${binUrl}`);
    warn("  - Homebrew:  brew install hummer98/tap/slack-chan");
    return;
  }
  tryClaudeRegister();
})();
