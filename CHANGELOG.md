# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- examples/slack-app-manifest.yml と docs/getting-started.md を追加 (T021)
- `slack-chan download <ts>` 実装: cache hit / Slack history fetch から
  files を取得して `$XDG_DATA_HOME/slack-chan/files/<team_id>/<file_id>[.<ext>]`
  に保存 (`--out`, `--force`, `--channel` 対応, T014)

### Changed

- (placeholder)

### Fixed

- (placeholder)

[Unreleased]: https://github.com/hummer98/slack-chan/compare/HEAD...HEAD
