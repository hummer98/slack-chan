# slack-chan

[![CI](https://github.com/hummer98/slack-chan/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hummer98/slack-chan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Slack interface for Claude — multi-workspace, default channels, persistent
local cache. Designed to be invoked by Claude Code via a Bash skill so the
agent can read context from Slack and post reports back without manual
plumbing.

> **Status: Phases 1–4 implemented; pre-`0.1.0`.** Phase 1–4 tasks
> (scaffolding & CI, SQLite cache, auth & config, all Slack feature
> commands, SKILL.md plugin, release & Homebrew pipelines) are complete
> and the CLI is locally usable via `bun run build:bin`. The first public
> release (`0.1.0` tag → `npm publish` → GitHub Release) and Anthropic
> official marketplace submission are still pending — see
> [Roadmap § Phase 5+](#roadmap).

## Quick start

```sh
# Requires Bun 1.3.x (pinned via .tool-versions for asdf / mise).
bun --version            # → 1.3.x
bun install
bun run dev -- --version # → 0.0.0
bun run dev -- --help
bun run typecheck
bun run lint
bun run test
bun run build:js         # → dist/slack-chan.js (npm publish bundle)
bun ./dist/slack-chan.js --version
bun run build:bin        # → dist/slack-chan (single binary, bun --compile)
./dist/slack-chan --version
```

### Install via Homebrew

```sh
brew install hummer98/tap/slack-chan
```

> 初回 release 後に有効化されます (それまでは `hummer98/homebrew-tap` の
> Formula が空のため tap が解決できません)。

## Setting up Slack — token をどう取るか

slack-chan を実際の Slack に繋ぐには、Slack App を作成して `xoxp` (User OAuth)
または `xoxb` (Bot) のトークンを取得する必要があります。手順とテンプレート
manifest は [`docs/getting-started.md`](docs/getting-started.md) と
[`examples/slack-app-manifest.yml`](examples/slack-app-manifest.yml) を参照して
ください。各 scope の意味付きの解説版は
[`examples/slack-app-manifest.commented.yml`](examples/slack-app-manifest.commented.yml)
にあります。

## Install as a Claude Code plugin

slack-chan は Claude Code plugin として配布されています。Claude が自然言語
で `slack-chan` の各サブコマンドを呼び出せるようにするには、以下のいずれ
かの方法で plugin を install してください。

### Quick local check（開発者・コントリビュータ向け）

リポジトリを clone した状態で、`--plugin-dir` フラグを使って Claude Code
にこのチェックアウトを直接読ませる:

```sh
git clone https://github.com/hummer98/slack-chan.git
cd slack-chan
bun install
bun run build:bin     # → ./dist/slack-chan を作る（PATH に通しておく）
claude --plugin-dir ./
```

Claude Code 起動後、`/help` の plugins セクションに `slack-chan:slack-chan`
が表示されれば成功です。

### Marketplace 経由で install（通常ユーザ向け）

`hummer98/slack-chan` リポジトリは single-plugin marketplace として
構成されているため、Claude Code から marketplace を追加してそのまま
install できます:

```sh
# Claude Code のプロンプトから:
/plugin marketplace add hummer98/slack-chan
/plugin install slack-chan@slack-chan-marketplace
```

CLI 本体（`slack-chan` バイナリ）は別途 npm か GitHub Release から install
してください（`## Quick start` の `bun run build:bin` か `npm install -g
slack-chan`）。plugin は CLI を `Bash(slack-chan:*)` 経由で呼ぶだけで、
バイナリ自体は同梱されません。

### Token と config の登録

plugin install 後、最初に 1 度だけ Slack token を登録します:

```sh
slack-chan config workspace add --token=xoxp-... --name=my-workspace
slack-chan config workspace set-default <team_id>
```

詳細手順は [`docs/getting-started.md`](docs/getting-started.md)。
**`xoxc-` / `xoxd-` トークンは AUP 違反のため拒絶されます** — 必ず
Slack App を作成して `xoxp-` / `xoxb-` を発行してください。

### 出力フォーマット (`--json` / `--toon` / `--human`)

各コマンドは 3 つの出力フォーマットを切り替えられます。デフォルトは
`--json` (= JSONL, 1 行 1 record)。詳細は ADR-0013 を参照
([`docs/decisions/0013-output-format-roles.md`](docs/decisions/0013-output-format-roles.md))。

| Flag | 用途 |
|---|---|
| `--json` (default) | 機械可読、scripting / AI 用、JSONL |
| `--toon` | AI 向け軽量フォーマット (ADR-0009 stub のまま JSONL に委譲) |
| `--human` | **CLI で人間が読む整形** (タイムライン / 表 / カード / 単位付き数値 / 相対時刻) |

`--human` 出力サンプル:

```sh
$ slack-chan read general --human --limit=2
2026-04-30 12:00:23  #全体周知  @U01SPAVUS3W
  <!channel> 再リマインドです！

2026-04-25 09:14:51  #全体周知  @U08URKDGRP0  ⤷ thread
  遅くなりましたがリマインドです。
  この後19時にこちらでお願いいたします！
```

```sh
$ slack-chan stats --human
Workspace: Toranomon (T9Q9BSR6C)
  Channels  : 1 (member: 0)
  Messages  : 40 (alive: 40)
  Users     : 193
  Files     : 0
  Last sync : 2026-04-25 09:20:24 (3 days ago)
  DB size   : 671.7 KiB
```

```sh
$ slack-chan config workspace list --human
TEAM_ID    NAME       DEFAULT_CHANNEL  TOKENS_STORE  TOKEN
─────────  ─────────  ───────────────  ────────────  ────────────
T9Q9BSR6C  Toranomon  (none)           keychain      xoxp-***001b
```

`--json` 出力の byte 表現は後方互換契約として安定です (scripting / AI 用)。
`--human` は UX 改善で随時整形が変わります。色は `process.stdout.isTTY` /
`NO_COLOR` / `SLACK_CHAN_NO_COLOR` で自動的に on/off 切り替えられます。

> **配布チャネルの設計判断**は
> [`docs/decisions/0010-plugin-distribution.md`](docs/decisions/0010-plugin-distribution.md)
> を参照。Anthropic 公式 marketplace（`claude-plugins-official`）への
> submission は将来別途行います。

## Roadmap

- **Phase 1: scaffolding** — ✅ Completed (T001-T004). `package.json`,
  `tsconfig.json`, `biome.json`, `src/` skeleton, AUP guard, `TokenStore`
  interface stub, empty migration, `bun test` + nock-fallback sanity, 5
  ADRs。CI (lint / typecheck / test)、コミュニティドキュメント
  (SECURITY / CONTRIBUTING / Code of Conduct / Issue&PR templates /
  Dependabot)、リリースパイプライン (GHA + npm OIDC Trusted Publishing +
  `bun build --compile` の 4 ターゲット assets) も T004 までで先行整備済み
  (ADR-0006 / [Releasing](#releasing))。
- **Phase 2: SQLite + auth + config + CLI subcommand router** — ✅
  Completed (T005-T010). Migration runner + DAO、Keychain / Secret Service
  / 0600 file token store、TOML config under XDG paths（env overrides 付き）、
  `SlackClient` ラッパ (rate-limit + redact logger)、CLI 骨格 + 出力
  フォーマッタ (`jsonl` / `human` / `toon-stub`)、`config` サブコマンド群
  (`workspace` / `channel` / `tokens-store` / `show`)。
- **Phase 3: Slack feature commands** — ✅ Completed (T011-T018). `read` /
  `post` / `dm` / `download` / `user` / `search` / `api` / `sync` /
  `stats`, with cache semantics (incremental fetch + recent-N refetch for
  edits / deletes, on-demand thread replies)。`search` は FTS5 ローカル
  キャッシュと Slack `search.messages` の並列マージ、`api` は generic
  Slack Web API escape hatch として実装。`search --cached-only` は
  FTS5 builtin trigram tokenizer で日本語の部分文字列検索に対応する
  (T025 / ADR-0012)。**初回起動時に `messages_fts` の rebuild が走る**
  ため、cache に多数の messages を持つユーザは初回のみ数秒〜数十秒
  待たされる場合がある。3 文字未満のクエリ（例: 1 文字日本語、2 文字
  ASCII の `OR` 等）は trigram の境界より短いため LIKE fallback で
  検索する（bm25 ランキングは適用されず、`ts DESC` 順に返却される）。
- **Phase 4: SKILL.md + recording helper + distribution** — ✅ Completed
  (T019-T022). Claude Code plugin manifest + SKILL.md
  （`hummer98/slack-chan` を single-plugin marketplace 化、ADR-0010、
  T019）、fixture 録画 helper + redact スクリプト
  (axios interceptor で録画 →`SlackFixtureRaw` を redact →
  `WebClient.prototype.apiCall` stub で再生、ADR-0009、T020)、
  Slack App manifest テンプレート + getting-started guide（T021）、
  Homebrew tap (`hummer98/homebrew-tap`) 向け auto-bump workflow +
  Formula テンプレート（T022、`release: published` で fixture 検証付きの
  PR 作成 workflow が走る）。npm publish と GitHub Release（compile
  binary）は T004 で先行整備済み（ADR-0006 / [Releasing](#releasing)）。
- **Phase 5+: 公開リリースと公式 marketplace submission** — `0.1.0` タグ
  を打って GitHub Release + `npm publish` を発行する初回公開リリース、
  Anthropic 公式 marketplace
  （`anthropics/claude-plugins-official`）への plugin 申請（ADR-0010 で
  「`0.1.0` タグ + npm publish 完了以降の別タスク」と明記）、
  `hummer98/homebrew-tap` repo の初回作成と初版 Formula の手動 push +
  `HOMEBREW_TAP_TOKEN` (Fine-grained PAT) の登録など、`bump-homebrew.yml`
  を稼働させるための一度きりの人間オペレーション（T022 残課題。手順は
  T022 マージ後に追加される `### Initial setup: Homebrew tap`、および
  `.team/tasks/022-*/runs/*/summary.md` を参照）。

See [`docs/seed.md`](docs/seed.md) for the design seed and
[`docs/decisions/`](docs/decisions/) for ADR-0001..0006 (SQLite driver,
CLI tooling, test runner, lint / format, CI policy, release process).

## Slack ToS / Acceptable Use Policy

Only `xoxp-` (User OAuth) and `xoxb-` (Bot) tokens are accepted.
`xoxc-` and `xoxd-` browser-session tokens are **rejected at the boundary**
because using them via the Web API violates Slack's Acceptable Use Policy
(AUP), risking account suspension. The guard lives in
[`src/secrets/guard.ts`](src/secrets/guard.ts) and is exercised in
[`tests/secrets/guard.test.ts`](tests/secrets/guard.test.ts).

## Toolchain

- Runtime: Bun 1.3.x (see [`.tool-versions`](.tool-versions))
- Language: TypeScript 6 (strict)
- Lint / format: Biome 2 (`biome check`)
- Test runner: `bun test`
- HTTP mocking (Phase 1 sanity): `WebClient.apiCall` stub, with `nock`
  retained as a devDep for Phase 5 re-evaluation (see ADR-0003)
- Build:
  - `bun build --target=bun` → `dist/slack-chan.js` (npm publish bundle,
    requires Bun runtime to execute)
  - `bun build --compile --target=bun-{darwin,linux}-{arm64,x64}` →
    single binary at `dist/slack-chan` (GitHub Release artifact)

## Implementation notes

- **`package.json#bin` / `main` / `exports` point to `./dist/slack-chan.js`
  (T004 で `dist/` に切り替え済み)。** ADR-0002 Consequences の Phase 1
  限定注記の宿題は T004 リリースプロセス整備で清算した。`bun build
  --target=bun` でバンドルした単一 JS ファイルを npm 経由で配り、Bun ランタイム
  を `#!/usr/bin/env bun` shebang で要求する。Node.js では起動しない（拒絶
  される）。詳細は ADR-0006。
- nock is currently unable to intercept Bun's `ClientRequest` (the
  `req.path` property is a readonly proxy in Bun 1.3.13), so the
  `tests/slack/auth.test.ts` sanity check stubs `WebClient.prototype.apiCall`
  directly. Phase 5 (recording helper) will revisit nock vs msw. See
  ADR-0003 Consequences.

## Releasing

> このセクションは **メンテナ向け**。一般利用者は読み飛ばして OK。

slack-chan のリリースは「`/release X.Y.Z`（または `bash scripts/release.sh
X.Y.Z`）でローカルから tag を打って push」→「`.github/workflows/release.yml`
が tag を受けて npm publish + GitHub Release を作成」の 2 段で完結する。

### 通常リリース手順

1. `main` ブランチの clean tree に居ることを確認:
   ```sh
   git switch main && git pull --ff-only && git status
   ```
2. （任意）dry-run で挙動を確認:
   ```sh
   /release --dry-run 0.1.0     # Claude Code 内
   bash scripts/release.sh --dry-run 0.1.0   # 通常 shell から
   ```
3. 本番:
   ```sh
   /release 0.1.0
   ```
   スクリプトが自動で:
   - `CHANGELOG.md` の `## [Unreleased]` を `## [0.1.0] - YYYY-MM-DD` に昇格、
     新しい空 `## [Unreleased]` を上に再挿入
   - `package.json#version` を `0.1.0` に書き換え
   - `bun install`（lockfile 反映）
   - `chore: release v0.1.0` でコミット
   - tag `v0.1.0` を打つ
   - `origin main` と tag を push
4. push 後は GitHub Actions の `Release` workflow が自動で:
   - `npm publish --provenance --access public`（OIDC Trusted Publishing）
   - `bun --compile` で 4 ターゲット（darwin-arm64 / darwin-x64 /
     linux-x64 / linux-arm64）のバイナリを生成
   - `gh release create` で GitHub Release を作り、4 バイナリ +
     `SHA256SUMS` を添付
5. `Release` workflow の完了 (release published) を受けて
   `.github/workflows/bump-homebrew.yml` が `hummer98/homebrew-tap` リポジトリに
   Formula 更新 PR を出す（merge は手動で yamamoto が実施）。

### CHANGELOG の書き方

[Keep a Changelog v1.1.0](https://keepachangelog.com/en/1.1.0/) に準拠。
日々の PR は `## [Unreleased]` セクションに `### Added` / `### Changed`
/ `### Fixed` / `### Removed` / `### Deprecated` / `### Security` の
カテゴリで追記する。`/release` 実行時に自動でバージョン枠に昇格する。

### Initial publish setup（npm OIDC Trusted Publishing 登録）

OIDC Trusted Publishing は「既に publish 済みパッケージ」が前提のため、初回だけ
鶏卵問題がある。手順:

1. **初回のみ**: ローカルから `npm publish --access public` を一度叩いて
   パッケージを npm に登録する（`hummer98` の認証情報が必要）。
   ```sh
   npm login
   bun run build:js
   npm publish --access public
   ```
2. [npmjs.com](https://www.npmjs.com/package/slack-chan) の package
   settings → **Trusted Publishers** → **Add GitHub Actions**:
   - Repository: `hummer98/slack-chan`
   - Workflow filename: `release.yml`
   - Environment name: （空欄で OK）
3. 以降は `git tag vX.Y.Z && git push --tags`（または `/release X.Y.Z`）
   で全自動。`release.yml` 側は `--provenance --access public` のみで
   OIDC が効くため、追加の secret は不要。

### Initial setup: Homebrew tap

`brew install hummer98/tap/slack-chan` を有効化するには、初回だけ以下を
人手でセットアップする必要がある（`bump-homebrew.yml` は 2 回目以降を
自動化するためのもの）。

1. **空 tap repo を作成**: GitHub で `hummer98/homebrew-tap` を作り、
   `main` ブランチを初期化する (空 commit でも README 1 枚でも OK)。
   ```sh
   gh repo create hummer98/homebrew-tap --public --description "Homebrew tap for hummer98 tools"
   git clone https://github.com/hummer98/homebrew-tap
   cd homebrew-tap
   git switch -c main
   echo "# hummer98/homebrew-tap" > README.md
   git add README.md && git commit -m "init: empty tap"
   git push -u origin main
   ```
2. **初回 Formula を手動 push**: `slack-chan` repo の
   `homebrew/slack-chan.rb.tmpl` をローカルで `envsubst` して `Formula/slack-chan.rb`
   を生成し、`hummer98/homebrew-tap` に手で commit/push する。初 release tag
   が打たれた後に `bash scripts/check-homebrew-template.sh` が通ることを
   確認してから実 SHA256SUMS の値で展開するのが安全。
3. **Fine-grained PAT を発行**: GitHub Settings → Developer settings →
   Personal access tokens → Fine-grained tokens で
   `Repository access: hummer98/homebrew-tap`、`Permissions: Contents: read/write`
   + `Pull requests: read/write` の PAT を発行する。
4. **`HOMEBREW_TAP_TOKEN` secret を登録**: `slack-chan` repo の
   Settings → Secrets and variables → Actions → New repository secret で
   `HOMEBREW_TAP_TOKEN` という名前で 3 で発行した PAT を登録する。
5. **初 release tag を打つ**: `/release X.Y.Z` で `slack-chan` の初 release を
   作成する。`Release` workflow が完了すると `bump-homebrew.yml` が
   `hummer98/homebrew-tap` に PR を出すので、内容を確認して merge する。
   以降は同じパスで自動更新される。

### Verifying with dry-run

`bump-homebrew.yml` は `workflow_dispatch` で手動起動でき、`dry_run=true`
（既定）なら **PR 作成 step を skip し、生成した Formula の diff だけを
job log に出して終了** するので、tap repo に PR が作られることはない
（`peter-evans/create-pull-request@v6` 自体には `dry-run` input が無い
ため、step ごと条件分岐させている）。

```sh
# 実 release が無い段階でも、homebrew/.test-fixtures/SHA256SUMS を使う
# fixture モードで Formula 生成 → PR diff の確認だけを通せる:
gh workflow run bump-homebrew.yml -f dry_run=true

# 実 release tag (例: v0.1.0) で diff を確認する:
gh workflow run bump-homebrew.yml -f dry_run=true -f tag=v0.1.0
```

job log に `homebrew-tap/Formula/slack-chan.rb` の diff が出ること、
`gh pr list -R hummer98/homebrew-tap` で **PR が作られていない**ことを
確認する。fixture モード時は dummy sha (`a`/`b`/`c`/`d` 64 文字) と
バージョン `0.0.0-fixture` が埋め込まれるので、本番値と取り違える心配は
無い。

ローカルで Formula 単体の構文確認だけしたいときは:

```sh
bash scripts/check-homebrew-template.sh
```

`envsubst` で fixture 値を埋めて `ruby -c` に通すだけ (PAT も Actions も不要)。

### Rollback / 失敗時の手順

リリース途中で何か壊れた場合の巻き戻し手順:

- **tag を打ったが push 前**:
  ```sh
  git tag -d vX.Y.Z
  git reset --hard HEAD~1
  ```
- **tag を push 済みだが npm publish 前 / 失敗した**:
  ```sh
  git push --delete origin vX.Y.Z
  git tag -d vX.Y.Z
  git reset --hard HEAD~1
  git push --force-with-lease origin main   # ※ 直近 commit が他に依存していない時のみ
  ```
  `release.yml` を再実行したい場合は CHANGELOG / package.json を整え直して
  もう一度 `/release X.Y.Z` を叩く。
- **npm publish は成功したが GitHub Release が壊れた**:
  `gh release delete vX.Y.Z` で Release だけ消して `gh release create
  vX.Y.Z` を手動で作り直す（npm 側の version は yank しない方針 — yank した
  バージョン番号は再利用できないため）。
- **OIDC 未登録のまま tag push してしまった**:
  workflow は `npm publish` ステップで失敗するが、CHANGELOG / tag は既に
  push 済みで整合性は壊れていない。Trusted Publisher 登録後、`workflow_
  dispatch` から手動で再実行するか、tag を打ち直して再 trigger する。

> 詳細な設計判断は [`docs/decisions/0006-release-process.md`](docs/decisions/0006-release-process.md)
> を参照。

## License

MIT — see [`LICENSE`](LICENSE).

詳細な変更履歴は [`CHANGELOG.md`](CHANGELOG.md) を参照。
