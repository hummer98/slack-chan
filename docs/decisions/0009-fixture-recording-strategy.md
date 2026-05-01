# ADR-0009: Slack fixture 戦略 — axios 録画 + apiCall 再生

- Status: Accepted
- Date: 2026-04-29
- Phase: 5 (録画 helper + redact)

## Context

ADR-0003 Consequences で「Phase 5 録画 helper タスクで nock のバージョンアップと
Bun のバージョンアップを再評価し、ダメなら msw への切り替えを行う」と宿題に
していた。Phase 1 で確認した nock 14.0.13 + Bun 1.3.13 の不整合
(`InterceptedRequestRouter` が Bun の `ClientRequest.path` readonly proxy に
再代入できない) は Phase 5 開始時点でも未解消で、Bun 側に修正がランディング
した形跡もない。msw v2 系も最終的に Node の `http.ClientRequest` を patch する
ため、同じ層で同じ readonly 制約に当たる蓋然性が高い。

Phase 5 の目標は「録画 → redact → 再生」の workflow を確立することであって、
HTTP 層 intercept そのものではない。Phase 1〜2 で `WebClient.prototype.apiCall`
を `spyOn` する pattern が既に動いており、`tests/slack/client.test.ts` の
retry 検証は instance-level の `axios.post` 直接 stub で書けている。これらを
延長して「録画は axios layer・再生は apiCall layer」のハイブリッドにすれば、
新しい依存ゼロで MVP を満たせる。

## Decision

採用案: **axios interceptors で録画 / `WebClient.prototype.apiCall` で再生**。

- 録画 (`scripts/record-fixtures.ts`): 実 SlackClient を生成し、内部の
  `client.axios.interceptors.response.use(fn)` で生レスポンスを横取りして
  `SlackFixtureRaw` (redacted: false) として `tests/fixtures/slack/<method>/<scenario>.json`
  に書き出す。
- redact (`scripts/redact-fixtures.ts`): `SlackFixtureRaw` → `SlackFixture`
  (redacted: true) の遷移を担う。token / email / Slack ID 群 / `text` 系 key を
  ルールベースで置換する。`--check` モードで CI / pre-commit gate に使う。
- 再生 (`src/testing/fixture-replay.ts`): `replayFixture(path)` が JSON を
  読み、`redacted !== true` なら throw、`spyOn(WebClient.prototype, "apiCall")`
  に `mockResolvedValue(fixture.data)` を仕込む。

却下案: **nock を Phase 5 で再試行**は、Bun 側の修正がランディングするまで
状況が変わらないため、見送る。`msw` も同じ層を patch するため代替にならず、
新規依存を増やしてもリターンが薄い。`nock` devDep は将来再評価の足場として
削除しない。`apiCall stub` だけで完結する案 (案 #3) は「録画」を成立させる
ために結局 axios 層を覗く必要があり、二重実装になる。

詳細な trade-off と plan B/C は plan.md §1.2 / §6 に残す。

## Consequences

`@slack/web-api` v7 の internal property である `client.axios` に依存するため、
v8 でリネームされたら録画スクリプトを書き直す必要がある。再生側 (`apiCall`
層) には影響しない。

`text` キーの redact は値の中身を見ず key 一致で問答無用で
`redacted-message-N` に置換する。これは regex で日本語などの非 ASCII PII を
拾えない問題への安全側の倒し方で、副作用として `block.type === "rich_text"`
配下の短いメタ情報文字列も置換される。固定値が必要な fixture では redact 後に
手動で書き戻す運用 (`tests/fixtures/slack/README.md` と CONTRIBUTING.md に
明記)。

Slack ID redact は ASCII `\b` 単語境界を使う。lookbehind/lookahead は使わない。
既知の制約として `U123ABC456_extra` のようにアンダースコア連結された ID は
`\b` がマッチせず redact から漏れる。Slack の通常レスポンスでは出現しない
形なので MVP では許容するが、将来カスタムフィールドで遭遇したら手動上書き
する。

`nock` devDep は削除せず残す。本 ADR は ADR-0003 Consequences の宿題に対する
解答であり、将来 nock / msw / Bun の互換性が変化したら再評価する材料を保つ。
