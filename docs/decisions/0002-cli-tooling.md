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

**Update (2026-04-29, T009)**: Phase 2 で予定していた CLI フレームワーク
再評価（`citty` / `commander`）の結論を本タスクで確定した。**Phase 2 以降
も `util.parseArgs` (Node 標準) を継続採用**する。決定理由は以下:

1. **ADR-0001 依存最小化との整合**: ADR-0006 の `bun build --compile` 単一
   バイナリ配布が一次経路であり、CLI フレームワークの追加は ~30-50KB の
   バンドル肥大と起動コスト微増を招く。
2. **サブコマンド数 10 + nested は dispatcher 関数で十分**: nested は
   `config` サブコマンドのみ（`config workspace add` 等）で、`subcommand[0]
   === "config"` の二段ルーティングで吸収できる。手書きで読みやすい量に収まる。
3. **`tokens: true` モードで global / subcommand 境界を堅牢に取れる**:
   Node v20 で安定化した `parseArgs` の tokens API を使い、global flag
   (`--workspace`, `--json|--toon|--human`, `--verbose`, `--help`,
   `--version`) と subcommand 固有 flag を分離する。`citty` 等の独自抽象を
   入れる優位性は薄い。
4. **help 自動生成は本フェーズではマイナス**: T009 では top-level help のみ
   を提供し、subcommand 個別 help は T010 以降の本実装と同時に書く方が DRY。
5. **将来の差し替え自由度を保つ**: `runCli(rawArgs): Promise<number>` を
   export する形は維持されるので、後日 `citty` 等に移行する判断が出ても
   影響は `src/cli/` 配下に閉じる。

T009 で導入した CLI 骨格の構成:
- `src/cli/index.ts` — `runCli` (Promise<number> を返す)、`installGlobalHandlers`
- `src/cli/flags.ts` — `parseGlobalFlags` (global flag parser、`tokens: true` 利用)
- `src/cli/router.ts` — `CommandContext` / `dispatch`
- `src/cli/commands/` — 10 サブコマンドの stub
- `src/cli/errors.ts` / `src/cli/exit-codes.ts` — `CliError` 階層と exit 0/1/2/3

これにより ADR-0002 の Phase 2 宿題（CLI フレームワーク再評価）は **Closed**。
新規 ADR は作らず、本 ADR の追記のみで決定経緯を保存する。
