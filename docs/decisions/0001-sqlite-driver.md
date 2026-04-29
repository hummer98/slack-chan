# ADR-0001: SQLite ドライバ — `bun:sqlite` を採用

- Status: Accepted
- Date: 2026-04-29
- Phase: 1 (scaffolding)

## Context

slack-chan は Slack のチャンネル / メッセージ / ユーザ / ファイルを SQLite に
キャッシュし、FTS5 で全文検索する設計（`docs/seed.md` §3.2 / §4.2）。配布形態は
`bun build --compile` の単一バイナリを Phase 1 から採用するため、ネイティブ
モジュールの ABI 不一致問題を避けたい。

## Decision

`bun:sqlite`（Bun 同梱）を採用する。`better-sqlite3` は採用しない。

## Consequences

`bun build --compile` で生成する単一バイナリにそのまま含まれ、`bun install -g`
時の NODE_MODULE_VERSION 不一致リスクが消える。型定義は `@types/bun` 内の shim
で引けるため追加 devDep ゼロ。API は `better-sqlite3` を参考に設計され大半は
互換だが、`Statement#iterate()` 等の細部に差はある。リスクは Bun 同梱 SQLite の
機能フラグ（特に FTS5）に依存する点。**Phase 2 storage タスクの先頭で
`CREATE VIRTUAL TABLE __fts USING fts5(x); DROP TABLE __fts;` の sanity check
を実装し、不可なら本 ADR を更新して `better-sqlite3` + `@types/better-sqlite3`
へ swap する。** `bun:sqlite` の import は `src/storage/db.ts`（Phase 2 で新設）
1 箇所からのみとし、差し替え時の影響範囲を局所化する。
