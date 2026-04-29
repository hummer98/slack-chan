# slack-chan

[![CI](https://github.com/hummer98/slack-chan/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/hummer98/slack-chan/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Slack interface for Claude — multi-workspace, default channels, persistent
local cache. Designed to be invoked by Claude Code via a Bash skill so the
agent can read context from Slack and post reports back without manual
plumbing.

> **Status: Phase 1 scaffolding only.** This repository currently contains
> the runtime / language setup, the directory skeleton for Phase 2+, the
> Slack AUP guard, and a minimal CLI that supports `--version` / `--help`.
> No subcommand is implemented yet.

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

## Roadmap

- **Phase 1 (current PR): scaffolding** — `package.json`, `tsconfig.json`,
  `biome.json`, `src/` skeleton, AUP guard, `TokenStore` interface stub,
  empty migration, `bun test` + nock-fallback sanity, 5 ADRs.
- **Phase 2: SQLite + auth + config + CLI subcommand router** — real
  migrations, Keychain / Secret Service / 0600 file token store, TOML
  config under XDG paths, `citty`-style subcommand routing.
- **Phase 3: Slack feature commands** — `read` / `post` / `dm` / `download`
  / `user` / `search` / `api` / `sync` / `stats`, with cache semantics
  (incremental fetch + recent-N refetch for edits/deletes, on-demand
  thread replies).
- **Phase 4: SKILL.md + recording helper + distribution** — Claude Code
  plugin marketplace entry, npm publish, Homebrew tap, `bun build --compile`
  release pipeline. — **npm publish と GitHub Release（compile binary）は
  T004 で先行整備済み（ADR-0006 / [Releasing](#releasing)）。Homebrew tap
  と plugin marketplace 登録は Phase 4 で扱う。**

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
