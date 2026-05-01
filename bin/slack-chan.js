#!/usr/bin/env node
// npm の bin エントリ。隣に置かれた bun --compile 済み self-contained binary
// (bin/slack-chan-native) を spawn するだけの薄ラッパ。native binary は
// postinstall.js が GitHub Release から DL する。
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const native = join(here, "slack-chan-native");

if (!existsSync(native)) {
  process.stderr.write(
    [
      "slack-chan: native binary が見つかりません。",
      "",
      "postinstall がスキップされた可能性があります。以下のいずれかで復旧してください:",
      "  - 再インストール:  npm i -g @hummer98/slack-chan",
      "  - Homebrew:        brew install hummer98/tap/slack-chan",
      "  - 手動 DL:         https://github.com/hummer98/slack-chan/releases",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const child = spawn(native, process.argv.slice(2), { stdio: "inherit" });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exit(code ?? 1);
});
child.on("error", (err) => {
  process.stderr.write(`slack-chan: failed to spawn native binary: ${err.message}\n`);
  process.exit(1);
});
