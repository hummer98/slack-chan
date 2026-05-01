# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- `.claude-plugin/plugin.json` と `.claude-plugin/marketplace.json` および
  `skills/slack-chan/SKILL.md` を追加し、本リポジトリを Claude Code plugin
  として配布できる構造を整備（`/plugin marketplace add hummer98/slack-chan`
  → `/plugin install slack-chan@slack-chan-marketplace` で install 可能）。
  marketplace 戦略は ADR-0010 を参照 (T019)
- `slack-chan api <method> [k=v ...] [k:=<json> ...]` 実装:
  Slack Web API 任意 method を呼び出す escape hatch。`--workspace` 必須
  （default fallback なし、誤書き込み防止）。レスポンスは `ok` の真偽に
  関わらず JSONL 1 行で stdout、transport エラーのみ exit code に反映 (T017)
- examples/slack-app-manifest.yml と docs/getting-started.md を追加 (T021)
- `slack-chan download <ts>` 実装: cache hit / Slack history fetch から
  files を取得して `$XDG_DATA_HOME/slack-chan/files/<team_id>/<file_id>[.<ext>]`
  に保存 (`--out`, `--force`, `--channel` 対応, T014)
- `slack-chan dm <user> <text>` / `slack-chan dm <user> --read` 実装:
  `<user>` を Uxxx / email / @name から user_id に解決し
  `conversations.open` で IM channel を開いて post / read 経路に再委譲
  (T013)
- Homebrew tap auto-bump workflow + Formula template (`brew install hummer98/tap/slack-chan`) (T022)

### Changed

- (placeholder)

### Fixed

- `config workspace remove` の TTY 検出をテスト時に明示的に注入できるよう
  改修。`Effects` に `isTTY(): boolean` を追加し、ハンドラは
  `effects.isTTY()` を `promptYesNo` に渡す。これにより `process.stdin.isTTY`
  への暗黙依存が解消され、対話 shell から `npm publish` を叩いた際に
  `prepublishOnly` の `bun run test` で
  `(2) without --yes and TTY=false → UserError` テストが ~4 秒 hang した上で
  失敗する事象が解消（実環境での利用時の挙動は変わらない）。

[Unreleased]: https://github.com/hummer98/slack-chan/compare/HEAD...HEAD
