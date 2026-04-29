# ADR-0005: CI policy — GitHub Actions で lint / typecheck / test を自動化

- Status: Accepted
- Date: 2026-04-29
- Phase: 1 (scaffolding)

## Context

T001 で `bun run lint` / `bun run typecheck` / `bun run test` の 3 つを
scaffolding した（ADR-0003 / ADR-0004）。これらを PR で必ず通すための CI が
必要になる。slack-chan は OSS リポジトリ（`hummer98/slack-chan`）として
GitHub に置かれており、GitHub Actions が public repo の無料枠で利用できる。
Bun の公式 setup action（`oven-sh/setup-bun@v2`）も利用可能で、Bun ランタイム
前提の本プロジェクトと相性が良い。

## Decision

- CI には GitHub Actions を採用する。
- `.github/workflows/ci.yml` で 3 jobs（lint / typecheck / test）を
  `ubuntu-latest` × `macos-latest` の 2 OS matrix で並列実行する
  （Windows は Bun の alpha 状態のため Phase 1 では除外）。
- Bun のバージョンは `oven-sh/setup-bun@v2` の `bun-version: 1.3.13` で
  完全一致 pin する（`.tool-versions` と同期）。
- `bun install --frozen-lockfile` で lockfile drift を検出する。
- 依存キャッシュは `actions/cache@v4` で `~/.bun/install/cache` を
  `bun.lock` のハッシュキーで明示的に張る（`bun.lockb` バイナリ形式ではなく
  Bun 1.2+ のテキスト形式 `bun.lock` を採用済み）。`oven-sh/setup-bun@v2`
  内蔵 cache は使わない。
- ブランチ保護（main 直 push 禁止 / CI 必須化）は GitHub UI 上で yamamoto
  が手動設定する。本リポジトリの CI/CD コードでは扱わない。
- secrets は使わない。Slack 実 API は CI では叩かず、`WebClient.apiCall`
  stub と nock（フォールバック先）で完結させる（ADR-0003 参照）。

## Consequences

PR ごとに 6 並列ジョブ（3 jobs × 2 OS）が走る。scaffolding 段階のジョブは
どれも数十秒〜数分で終わるため、public repo の Actions クォータ範囲で
運用可能。`fail-fast: false` を指定してあるので片方の OS が落ちても他方の
結果は最後まで取得できる。

ブランチ保護を手動設定とすることでリポジトリ初期化フローと CI 実装を分離
できる。設定漏れは README と本 ADR の運用ガイドで担保する。yamamoto
（リポジトリ owner）が責任を持つ。

将来 Windows 対応や e2e（実 Slack API）テストを追加する際は、本 workflow
の matrix と secrets を別 ADR で再設計する。`bun.lock` をキーにしたキャッ
シュは Bun 1.2+ のテキスト形式 lockfile に依存するため、Bun バージョンを
下げる場合は cache key の見直しが必要。

## ブランチ保護の運用ガイド

GitHub Web UI で main ブランチに以下を設定すること（手動）:

1. Settings → Branches → Add branch ruleset
2. Branch name pattern: `main`
3. Require a pull request before merging: ON
4. Require status checks to pass before merging: ON
   - 必須チェック: `lint (ubuntu-latest)` / `lint (macos-latest)` /
     `typecheck (ubuntu-latest)` / `typecheck (macos-latest)` /
     `test (ubuntu-latest)` / `test (macos-latest)`
5. Require branches to be up to date before merging: ON（任意）
6. Restrict pushes that create matching branches: ON（直 push 禁止）

設定変更は yamamoto（リポジトリ owner）が責任を持つ。
