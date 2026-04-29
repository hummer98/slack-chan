# ADR-0003: テストランナー — `bun test` を採用

- Status: Accepted
- Date: 2026-04-29
- Phase: 1 (scaffolding)

## Context

slack-chan は Bun ランタイム前提・DOM 不要・pure TypeScript / Slack Web API
テストのみ。テストランナーの第一候補は `bun test`、対抗は `vitest`。

## Decision

`bun test` を採用する。Bun 同梱で追加 devDep ゼロ、Jest 互換 API（`describe`
/ `it` / `expect` / `spyOn` / `mock`）、watch mode あり、TypeScript ネイティブ。
本プロジェクトは jsdom / inline snapshot を使わないため `bun test` の制約には
触れない。

## Consequences

**nock + Bun 互換問題（Phase 1 で発覚）**: nock 14.0.13 + bun 1.3.13 の組み
合わせでは、nock の `InterceptedRequestRouter` が Bun の `ClientRequest` の
`req.path` プロパティ（readonly proxy）に再代入できず、HTTP 層の intercept が
できない。Phase 1 の `tests/slack/auth.test.ts` は plan §6.2 のフォールバックに
従い、`WebClient.prototype.apiCall` を `bun:test` の `spyOn` で直接 stub する
形に切り替えた。nock 自体は devDep に残してあるので、Phase 5 録画 helper タスク
で nock のバージョンアップ + Bun のバージョンアップを再評価し、ダメなら `msw`
（fetch-base 含めた intercept）への切り替えを行う。

性能優位（Bun ランタイムネイティブで高速）は二次的根拠にとどめ、定量比較は
実測まで保留する。
