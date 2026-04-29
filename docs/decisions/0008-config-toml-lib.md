# ADR-0008: TOML ライブラリ — `smol-toml` を採用

- Status: Accepted
- Date: 2026-04-29
- Phase: 2 (config 層)

## Context

`$XDG_CONFIG_HOME/slack-chan/config.toml` を読み書きする config 層が必要
（docs/seed.md §4.1、T007）。書き込みが完了条件に含まれるため、Bun 組込の
TOML import（`with { type: "toml" }`）では満たせない。ADR-0001 の方針
（依存追加は局所化＋ADR で正当化）に従い、ライブラリを 1 本選定する。

## Decision

`smol-toml@^1` を `dependencies` に追加し、`src/config/io.ts` 1 ファイルから
のみ import する。代替（`@iarna/toml` ~50KB / `@ltd/j-toml` ~80KB）は採用しない。

## Consequences

zero-dep / ESM-first / TypeScript 型同梱 / TOML 1.0 準拠 / 約 10KB と軽量で、
`bun build --compile` 単一バイナリ配布ポリシ（ADR-0001）と矛盾しない。MIT
ライセンス。差し替え時の影響範囲は `src/config/io.ts` に閉じる
（`bun:sqlite` の前例に倣う）。`smol-toml` の数値表現が将来変わった場合に
備え、`tests/config/io.test.ts` で toml-string round-trip テストを 1 ケース
保持し regression を検知する。
