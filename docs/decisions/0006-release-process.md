# ADR-0006: リリースプロセス — GitHub Actions + npm OIDC + bun compile assets

- Status: Accepted
- Date: 2026-04-29
- Phase: 1 末端（配布レーン整備）

## Context

T001..T003 で scaffolding（runtime / lint / test / CI）が揃った段階で、Phase 2+
の機能実装に着手する前に **配布レーンを最初に通しておく** のが安全という判断
（`docs/seed.md` §3.6 の配布優先順位と整合）。リリース未整備のままで Phase 2 の
機能 PR を量産すると、後から CHANGELOG / version / npm publish / GitHub
Release をバックフィルするコストが膨らむ。

参照可能な実装が 2 つある: (a) cmux-team `.github/workflows/release.yml`
（npm OIDC Trusted Publishing + `awk` による CHANGELOG 抽出 + `gh release
create`）、(b) Bun の `--compile --target=bun-{darwin,linux}-{arm64,x64}` による
cross-compile（公式サポート、ubuntu ホストから 4 ターゲット同時生成）。一方で
Homebrew tap は別リポジトリの formula 管理が必要で、本タスクのスコープを超える。

ADR-0002 Consequences で「Phase 1 限定の `package.json#bin` は `./src/cli/
index.ts` を直接指す。Phase 2+ の npm publish タスクで `dist/` に切り替える」
と申し送られている宿題を、本タスクで清算する。

## Decision

GitHub Actions の単一 workflow（`ubuntu-latest` 1 job）で **(a) npm publish
（OIDC Trusted Publishing、`--provenance --access public`）** と **(b) GitHub
Release（macOS/Linux × arm64/x64 の bun compile バイナリ 4 種 + `SHA256SUMS`
添付）** を同時に発火させる。tag `vX.Y.Z` の push を起点とし、`workflow_dispatch`
は dry-run 専用とする（`inputs.dry_run` のデフォルトを `true` にし、tag 起動時
のみ実 publish に進む）。

bin 戦略は二系統運用とする: **npm 配布は `bun build --target=bun` のバンドル
JS（`dist/slack-chan.js`）** を `bin` / `main` / `exports` にし、shebang
`#!/usr/bin/env bun` で Bun ランタイムを要求する。**GitHub Release は `bun
build --compile` の単一バイナリ 4 種** を ZIP/tarball 化せず生 binary のまま
配布する（拡張子なし、SHA256SUMS で整合性を担保）。npm の単一 tarball で OS 別
バイナリを `optionalDependencies` で配る案は規模超過のため採用しない。

`package.json#files` は `["dist/slack-chan.js", "README.md", "LICENSE",
"CHANGELOG.md"]` と JS バンドル 1 ファイルのみ明示する（`["dist"]` ではなく）。
これは `bun run build:bin` でローカル生成した 63MB の compile バイナリが
誤って npm tarball に同梱されるのを防ぐためで、配布物を 7KB 程度に抑える。

`/release` コマンドは `scripts/release.sh`（bash）を実体とし、`.claude/
commands/release.md` はその薄ラッパに留める。スクリプトは `--dry-run`
モードを持ち、CHANGELOG `## [Unreleased]` の昇格 / `package.json#version` の
書き換え / `bun install` / commit / tag / push の各ステップを 1 トランザクション
で実行する。CHANGELOG は Keep a Changelog v1.1.0 に準拠し、初期状態は
`## [Unreleased]` 1 セクションのみとする（初版枠は最初の実リリース時に
`/release` が起こす）。

`prepublishOnly` フックには `typecheck && test && build:js` を並べ、ローカルから
誤って `npm publish` を直接叩いた際の最後のセーフティネットとする。lint は CI
で十分カバーされるため publish blocker からは外す（`prepublishOnly` の主目的は
「コンパイルエラー / 壊れたテストで誤って publish する事故」を止めることであり、
スタイル違反まで止めるのは過剰）。

Homebrew tap への formula 公開は ADR-0007（後続タスク）で扱う。

## Consequences

tag 命名は `vX.Y.Z`（先頭 `v` プレフィックス）に固定する。`release.yml` も
`scripts/release.sh` も `v` を前提に組まれており、無印 tag では Release
作成も npm publish も起動しない。

**初回 publish の鶏卵問題**: npmjs.com の Trusted Publisher は「既に publish 済み
パッケージへの紐付け」が前提。本リポジトリは未 publish のため、初回だけは
`hummer98` 名義で `npm publish --access public` をローカルから叩く必要がある
場合がある（npm の policy 変更次第。README に手順を記載済み）。2 回目以降は
`/release X.Y.Z` で全自動化される。

**bun cross-compile が CI で失敗するリスク**: 特定ターゲットで Bun の
クロスサポートが欠ける場合は、(1) 失敗ターゲットのみ matrix（macos-latest /
ubuntu-latest）に外出し、(2) それも難しければ `continue-on-error: true` で
暫定スキップし ADR-0007 で再設計、の 2 段フォールバックを用意する。

**`prepublishOnly` で typecheck + test + build を強制する代償**として、ローカル
publish の事前時間が数十秒〜数分増える。CI と重複するが、誤 publish 防止のため
許容する。

**`package.json` の同時編集衝突**: 本タスクは `main` / `bin` / `exports` /
`files` / `repository` / `homepage` / `bugs` / `keywords` / `publishConfig` /
`scripts.build*` / `prepublishOnly` を一括書き換えするため、並列で `package.
json` を触る他タスクと衝突しやすい。衝突した場合は `scripts` セクションは
追記合成、`bin` / `main` / `exports` / `files` は本 PR の値（`dist/slack-chan.
js` 系）を後続が前提とするため優先する運用とする。本 PR は早めに rebase /
merge する。

将来 Windows ターゲット（Bun の Windows サポートが GA したら）や `optionalDeps`
経由の native binary 配布が必要になったら、本 ADR を更新せず ADR-0008 以降で
扱う。
