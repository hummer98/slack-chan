# ADR-0009: TOON 出力フォーマット — 仕様未決のため stub 実装

- Status: Proposed (deferred)
- Date: 2026-04-29
- Phase: 3 (CLI 骨格 / T009)

## Context

`docs/seed.md` §3.4 / §7.3 で「TOON (Token-Oriented Object Notation) を
AI-readable な軽量フォーマットとして検討」と書かれているが、参照仕様 URL /
既存実装 / 採用基準は未確定。T009（CLI 骨格 + 出力フォーマッタ）で
`--json` / `--toon` / `--human` の三択を CLI 層に実装する必要があるが、
TOON の本実装を待つと CLI 骨格全体が止まるためタイミングが噛み合わない。

## Decision

**T009 では `--toon` フラグを受け付け、`ToonFormatter` を `JsonlFormatter`
への薄い委譲として実装する**。ユーザは `--toon` を指定しても JSONL を
受け取る。本 ADR が `Accepted` に変わるまで、`--toon` の出力形式は契約に
含めない（今後 byte 表現が変わる可能性がある）。

実装位置:
- `src/output/toon.ts` — `ToonFormatter implements Formatter`
- `src/output/format.ts` — `selectFormatter("toon")` が `ToonFormatter` を返す
- `tests/output/toon.test.ts` — JSONL と byte-equal を保証

TOON 仕様の調査・確定および本実装は後続タスク（仮称 T-toon）に切り出す。

## Open Questions

- TOON の reference implementation / 公式仕様 URL（候補は調査未着手）
- JSONL との差別化要件（行頭マーカ / 型タグ / 空白圧縮 / トークン消費効率）
- AI 読みやすさのベンチマーク方法（同一データを LLM にパースさせて精度比較等）
- 本格採用しないと判断した場合の `--toon` フラグ扱い（撤廃 / JSONL の
  alias に固定 / deprecation 経由でのリネーム）

## Consequences

- ユーザ体験: `--toon` を指定しても出力は JSONL と同じ。stub と分かるよう
  `--help` の説明にも「currently delegates to JSONL — see ADR-0009」と明記。
- CLI の安定性 contract には `--toon` の出力 byte 表現を **含めない**。
  本 ADR が `Accepted` に変わった時点で初めて contract に格上げする。
- 後続タスク `T-toon` では本 ADR を Accepted にし、`ToonFormatter` の
  内部を差し替えるだけで CLI 表面は変わらない（`selectFormatter` の API
  も維持）。

## Related

- ADR-0001（依存最小化方針）— TOON 実装に外部ライブラリを採用する場合は
  本方針を再評価する
- ADR-0002（CLI ツール選定）— `--toon` flag の parse は `parseGlobalFlags`
  内で完結、frame work 側に依存しない
