# ADR-0002: CLI ツール — `Bun.argv` + `util.parseArgs`（Phase 2 で `citty` 再評価）

- Status: Accepted
- Date: 2026-04-29
- Phase: 1 (scaffolding)

## Context

Phase 1 の CLI スコープは `--version` と `--help` の表示のみで、サブコマンドの
ルーティング / lazy load / ヘルプ自動生成は Phase 2 まで実装しない（`task.md`
§6 / `docs/seed.md` §4.3）。CLI フレームワークを Phase 1 で確定すると、サブ
コマンド構造が固まる前の選定になり手戻りリスクが大きい。

## Decision

Phase 1 では依存ゼロの `Bun.argv` + Node 標準 `util.parseArgs` でハンドコードする。
CLI フレームワークの正式選定はサブコマンド構造が固まる Phase 2 に先送りする。
第一候補は `citty`（unjs エコシステム、`defineCommand` での型推論、サブコマンドの
lazy load、ヘルプ自動生成）、対抗は `commander`。

## Consequences

依存追加ゼロで Phase 1 を閉じられる。`src/cli/index.ts` は `runCli()` を export
し、Phase 2 で内部実装だけ差し替えられる構造にした。

**Phase 1 限定の注意**: `package.json` の `main` / `bin` / `exports` は
`./src/cli/index.ts` を直接指している（Bun ランタイムは `.ts` を直接実行
できる）。これは `bun build --compile` で配布する Phase 1 では成立するが、
`docs/seed.md` §3.6 で配布優先順位 2 位の **npm** 経由インストールでは
`.ts` を直接実行できない。**Phase 1: pre-build path; will switch to dist/
in npm publish task.** Phase 2 以降の npm publish タスクで
`bin: "./dist/index.js"` に切り替えるか、`dist/slack-chan` バイナリへの
シムスクリプトを置くかを決定する。Master へ「npm 配布時の `package.json`
形態の見直し」を Phase 2 task として独立起票することを申し送り済み。

**Update (2026-04-29, T004)**: 上記の宿題を T004 リリースプロセス整備で
清算した。`bin` / `main` / `exports` は `./dist/slack-chan.js`（`bun build
--target=bun` のバンドル JS）に切り替え済み。`bun build --compile` の
単一バイナリは GitHub Release 専用とする二系統運用に分離した。詳細は
ADR-0006 を参照。
