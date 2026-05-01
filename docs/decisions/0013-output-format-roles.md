# ADR-0013: `--json` / `--toon` / `--human` の役割分担と `--human` の再定義

- Status: Accepted
- Date: 2026-05-01
- Phase: 4 (CLI コマンド層)

## Context

T009（CLI 骨格 + 出力フォーマッタ）で `--json` / `--toon` / `--human` の 3 つを CLI 層に実装した。
このうち `--human` は当初 `JSON.stringify(record, null, 2)` を `dim` で囲むだけの実装（`src/output/human.ts`）として導入されたが、ユーザ視点では「`--human` なのに JSON が出る」状態で、フラグ名と挙動が乖離していた。

Phase 4 で各コマンド (`read` / `dm` / `search` / `user` / `stats` / `download` / `config workspace list` / `api` / `post` / `sync`) の record 型が安定した今、`--human` を本来の「人間が CLI 上で読みやすい整形」に再定義するタイミング。

関連:
- ADR-0009 (TOON, stub のまま据え置き)
- ADR-0001 (依存最小化方針: 整形は zero-dep で実装)

## Decision

### 1. 3 formatter の役割分担を明文化

| Format | 用途 | 想定読者 | 出力 byte 安定性 |
|---|---|---|---|
| `--json` (default, JSONL) | 機械可読、scripting / AI 用、1 行 1 record | パイプライン処理、Claude Code | **安定** (後方互換) |
| `--toon` | AI 向け軽量フォーマット (ADR-0009 stub のまま) | AI | 未確定 (stub) |
| `--human` | **CLI で人間が読む整形** (タイムライン / 表 / カード / KV / 色分け) | 端末で手で叩く人間 | **不安定** (UX 改善で随時変更) |

`--json` の byte 表現は引き続き安定契約。`--human` は今後も UX 改善で出力が変わり得るため byte 安定契約には含まない。

### 2. アーキテクチャ: 案 A (per-command renderer) を採用

**各コマンドが `renderXxxHuman(record, opts)` を持ち、CLI router (output モジュール) が `--human` 時にそれを呼ぶ**。

- `src/cli/commands/<cmd>/output.ts` で format 分岐: `format !== "human"` なら `selectFormatter(format).format(record)`、`format === "human"` なら `renderXxxHuman(...)`
- `src/cli/commands/config/format.ts` で先行実装されている `renderConfigShow` / `renderWorkspaceList` パターンの敷衍

採用理由:

1. **既存コードの先例**: `config/format.ts` で同じパターンが既に採用済み。新規コマンドにも同じ書き方を敷衍するのが自然
2. **record 型の純粋性**: 案 B (`__type` discriminated union) は record に `__type` を付けると `--json` 出力にも漏れて後方互換を破る。Symbol-keyed type tag 等で stripping する救済策はあるが、後段の DB 依存問題（採用理由 3）が解決しないため不採用
3. **DB 依存**: メッセージタイムラインは channel/user 名解決のため DB アクセスが必要。output 層に DAO を持ち込むより、handler が record に名前を埋めてから渡すほうが層分離が綺麗
4. **API レスポンスの多様性**: `api` の `WebAPICallResult` は `[key: string]: unknown` を含む union shape。一律 type 化が困難で、pretty JSON 維持を最初から想定するなら案 A が素直
5. **batch 処理**: タイムラインは複数メッセージに跨る整形（日付グルーピング、罫線）が必要。`Formatter.formatBatch` は per-record 設計とミスマッチで、per-command renderer なら自由に書ける

### 3. `HumanFormatter` (pretty JSON + dim) は廃止せず fallback として残す

- `api` / `post` / `dm --post` / `sync` の `--human` は引き続き `HumanFormatter` (pretty JSON + dim) を経由
- 役割を「**fallback default human renderer**」と再定義。各コマンドが human 整形を独自に持たない場合に呼ばれる素朴な実装
- 将来的に全コマンドが `renderXxxHuman` を持つようになれば撤廃を検討（Open Questions）

### 4. 共通ユーティリティ `src/output/human/`

zero-dep の純粋関数群を集約:

- `format.ts` — `humanBytes(n)`, `humanRelativeTime(now, then_ms)`, `formatLocalTimestamp(ts, tz)` (tz は明示引数)
- `kv-list.ts` — `formatKvList(entries, colors)` (label 列幅自動調整)
- `table.ts` — `formatTable(headers, rows, colors)` (列幅自動調整、`─` 区切り)
- `timeline.ts` — `formatTimeline(entries, colors)` (タイムスタンプ + channel + user + 本文)
- `profile-card.ts` — `formatProfileCard(card, colors)`
- `index.ts` — public re-export

すべて `ColorFns` を引数に取り、ANSI on/off を呼び出し側で決める。

### 5. TTY 検出 / 色抑止

既存の `isColorEnabled()` を尊重: `NO_COLOR` / `SLACK_CHAN_NO_COLOR` env、または `process.stdout.isTTY === false` で色を抑止。

### 6. redact 適用

`--human` 出力でも `redactSecrets` 等の機微情報除去は変えない。具体的には:

- token: `config workspace list` で `xoxp-***001b` 化済み (`redactToken`)。`--human` でも同じ化を維持
- email: `user` プロフィールカードで cache 内の email を表示 (Slack API から正規取得した値で、ログ経路ではないため redact 不要)
- メッセージ本文: 現状の `--json` 経路でも本文 redact は行っていないため、`--human` も追従しない (変更する場合は別タスク)

### 7. `formatLocalTimestamp` の timezone 引数

Node/Bun の libc `tzset` 動的反映が macOS / Linux で挙動差があるため、test 環境での `process.env.TZ` 書き換えに依存しない方針:

- **主案**: `formatLocalTimestamp(ts, tz: string)` の関数引数で渡す
- 補助案: env `TZ` 書き換えは fallback として許容するが、test では使わない

呼び出し側は config 等から tz を取得して渡す。test では `formatLocalTimestamp(ts, "Asia/Tokyo")` と書く。

## Open Questions

- **`--lines` truncate flag (`read`)**: 長文メッセージの truncate オプションは本タスク対象外。タイムライン整形時は全文表示。次の課題として記録
- **`api` の主要フィールド上部ハイライト**: `ok` / `team` / `user` / `channel` 等を上部ハイライトする経路は本タスク対象外。pretty JSON のまま
- **`search` の matched text ハイライトアルゴリズム**: FTS5 の正確な match offset 取得は別タスク。本タスクでは「クエリを空白分割して各 token を text 内で substring match」する MVP 実装で start
- **`HumanFormatter` 段階的廃止**: 本タスクでは fallback として残す。全コマンドが `renderXxxHuman` を持つようになれば撤廃を検討
- **全角文字幅**: `formatTable` の列幅計算は 1 char = 1 cell の MVP 実装。日本語等の全角文字で崩れる場合は `Intl.Segmenter` + East Asian Width 表で対応 (別タスク)
- **DM / IM channel name**: `channels.type === "im"` の場合は `#xxx` ではなく `@user_dm` 形式で表示する (本タスクで対応)

## Consequences

- ユーザ体験: `--human` が真に人間に優しくなる (タイムライン / 表 / カード / 単位付き数値 / 相対時刻)
- `--json` の出力 byte 表現は不変 (CI/CD や既存スクリプト互換)
- output 層は「per-record fallback (`HumanFormatter`)」と「per-command renderer (`renderXxxHuman`)」の二層構造に
- 共通ユーティリティを zero-dep で書くため、依存ライブラリは追加しない (ADR-0001 と整合)
- `--human` 指定時の出力 byte 表現は契約に含まないため、既存テストで `dim` ANSI を期待していた箇所 (`tests/cli/commands/read/handler.test.ts:284`, `tests/cli/commands/stats/handler.test.ts:125` 等) は新仕様に合わせて書き換える

## Related

- ADR-0001 (依存最小化方針)
- ADR-0009 (TOON, stub のまま据え置き)
