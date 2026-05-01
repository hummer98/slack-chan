# ADR-0014: `--rich` formatter（絵文字 + 強い色付け）の追加

- Status: Accepted
- Date: 2026-05-01
- Phase: 4 (CLI コマンド層)

## Context

ADR-0013 で `--human` を「CLI で人間が読む整形」に再定義し、タイムライン / 表 / プロフィールカード / KV リストといった per-command renderer を導入した。これにより `--human` は `--json` の素朴な pretty 表示から脱却し、十分実用的になった。

一方で `--human` は端末でのデモや screenshot で「味気ない」という声があり、特に以下の場面でより視覚的な区別が欲しいケースがある:

- 端末スクリーンショットや配信での見栄え
- `stats` / `user` などの一覧表示で「何の情報か」を絵文字で一目で識別したい
- `search` のヒットを背景色だけでなくアイコンで補強したい

`--human` の挙動を「色 + 絵文字あり」に変える選択肢もあるが、ADR-0013 で `--human` の出力は「不安定」と明記したとはいえ、CI ログや plain ASCII 環境（古いターミナル、ssh セッション、pager 経由）で絵文字が表示崩れする副作用は少なくない。よって既存の `--human` は据え置き、新たに「色 + 絵文字」の上位版フォーマットを追加する。

関連:
- ADR-0001 (依存最小化方針)
- ADR-0013 (`--json` / `--toon` / `--human` の役割分担)

## Decision

### 1. `--rich` を 4 つ目のフォーマットとして追加

| Format | 用途 | 想定読者 | 出力 byte 安定性 |
|---|---|---|---|
| `--json` (default, JSONL) | 機械可読、scripting / AI 用 | パイプライン処理、Claude Code | **安定** (後方互換) |
| `--toon` | AI 向け軽量フォーマット (ADR-0009 stub のまま) | AI | 未確定 |
| `--human` | CLI で人間が読む整形 (ASCII + 控えめな色) | plain な端末 / pager / ssh | **不安定** |
| `--rich` | `--human` + 絵文字アイコン + 強い色 | TTY / デモ / スクリーンショット | **不安定** |

`--rich` は `--human` の上位互換: 同じ整形構造（タイムライン / 表 / カード / KV）を踏襲し、ヘッダや label にユニコード絵文字とより目立つ色を載せる。

### 2. アーキテクチャ: ADR-0013 と同じ案 A を踏襲

各コマンドが `renderXxxRich(record, opts)` を持ち、CLI router (output モジュール) が `--rich` 時にそれを呼ぶ。

- `src/cli/commands/<cmd>/output.ts` の format 分岐を `format !== "human" && format !== "rich"` に拡張、それぞれに対応する renderer 呼び出しを追加
- `--rich` の整形ロジックは `--human` の整形 util を内部で再利用してロジック重複を最小化（後述 §4）
- `api` / `post` / `sync` は `--rich` でも `selectFormatter("rich")` 経由で `HumanFormatter` (pretty JSON + dim) に fallback。理由は ADR-0013 と同じ（response shape が多様）

### 3. `selectFormatter("rich")` は `HumanFormatter` を返す

新規に `RichFormatter` クラスを追加するのではなく、`selectFormatter("rich")` は既存の `HumanFormatter` (pretty JSON + dim) を返す:

- per-command renderer (`renderXxxRich`) を持つコマンドは output.ts 内で先に分岐するため、ここに到達しない
- per-record renderer を持たない `api` / `post` / `sync` 等は、`HumanFormatter` の素朴な pretty JSON 経由になる（既存 `--human` と同等）
- これにより専用 `RichFormatter` ファイルが不要になり、追加面が小さくなる

### 4. 共通ユーティリティ `src/output/rich/`

zero-dep の純粋関数群を集約。`src/output/human/` を内部呼び出しで再利用し、絵文字/装飾の差分のみを記述する:

- `format.ts` — `RichGlyphs` (絵文字定義) と `getGlyphs(emojiEnabled)` (NO_EMOJI 時はテキストフォールバック)
- `kv-list.ts` — `formatRichKvList(entries, colors, glyphs)` (各 label に絵文字 prefix を付与)
- `table.ts` — `formatRichTable(headers, rows, colors, opts)` (ヘッダを bold + cyan、絵文字 prefix オプション)
- `timeline.ts` — `formatRichTimeline(entries, colors, glyphs)` (📅 日付ヘッダ、🧵 thread, ✏️ edited)
- `profile-card.ts` — `formatRichProfileCard(card, colors, glyphs)` (👤 ヘッダ、各 field に絵文字)
- `header.ts` — `formatRichHeader(title, glyphs, colors)` (📦 / 🏢 等のセクションバナー)
- `index.ts` — public re-export

`src/output/human/*` は変更しない。`rich/*` から呼ぶだけ。

### 5. 絵文字スキーム

| コマンド / 文脈 | 絵文字 |
|---|---|
| `stats` Workspace ヘッダ | 📦 |
| `stats` Channels | 💬 |
| `stats` Messages | 📝 |
| `stats` Users | 👥 |
| `stats` Files | 📁 |
| `stats` Last sync | 🕐 |
| `stats` DB size | 💾 |
| `user` プロフィールヘッダ | 👤 |
| `user` Real name | 🪪 |
| `user` Display | 🏷️ |
| `user` Email | 📧 |
| `user` Title | 💼 |
| `user` TZ | 🌏 |
| `user` Status | 💭 |
| `config workspace list` ヘッダ | 🏢 |
| `read` / `search` thread indicator | 🧵 |
| `read` / `search` edited indicator | ✏️ |
| `read` / `search` 日付グループヘッダ | 📅 |
| `download` 成功 | ✅ |
| `download` skipped | ↺ |

### 6. TTY 検出 / 色抑止 / 絵文字抑止

既存の `isColorEnabled()` を尊重し、色制御は `--human` と同様。

絵文字抑止用に `isEmojiEnabled()` を新規追加:

- `SLACK_CHAN_NO_EMOJI` env が定義されている → false
- `process.stdout.isTTY === false` → false (pipe / redirect / non-TTY 時は絵文字オフ)
- `NO_COLOR` は色のみ抑止し絵文字は維持（独立した制御）

絵文字オフ時のフォールバック表現:

| 絵文字 | フォールバック |
|---|---|
| 📦 / 🏢 / 📅 / 👤 等のヘッダ | プレフィクスなし（plain text） |
| 🧵 (thread) | `⤷ thread` (`--human` と同じ) |
| ✅ / ↺ (download) | `✓` / `↺` (`--human` と同じ ASCII シンボル) |

すなわち、絵文字オフ時は `--human` 相当の出力に近づく。色は別途 `isColorEnabled()` で制御するため、絵文字オフ + 色オンの組合せもあり得る。

### 7. redact 適用

`--human` と同じく redact (token の `xoxp-***xxxx` 化等) を維持。新規 redact ロジックは追加しない。

### 8. デフォルト動作

`--rich` の default 化はしない。default は引き続き `--json` (JSONL)。`SLACK_CHAN_OUTPUT_FORMAT=rich` の env override は許容（既存の `output_format_override` パスがそのまま動く）。

## Open Questions

- **Windows の絵文字レンダリング**: Windows Terminal は対応するが、旧 conhost.exe では破綻する可能性。`SLACK_CHAN_NO_EMOJI=1` で逃げる前提で、自動検出は導入しない（別タスク）
- **絵文字の幅**: 多くの絵文字は 2 cell 幅だが、ターミナルや fallback フォントで 1 cell に縮む場合がある。本タスクでは `formatTable` / `formatKvList` の幅計算を絵文字を除外して行う（label テキストのみで揃え、絵文字は左外側に置く）方針で対処
- **アニメーションや spinner**: `download` のスループット表示など動的要素は本タスク対象外
- **i18n (英語以外の絵文字選定)**: 絵文字は universal なので i18n は当面不要

## Consequences

- 4 formatter 体制に拡張: `--json` / `--toon` / `--human` / `--rich`
- 既存の `--human` は据え置き (ADR-0013 の契約は不変)
- `selectFormatter("rich")` は `HumanFormatter` を返すため、per-command renderer を持たないコマンド (`api` / `post` / `sync`) は `--human` と同等の挙動になる
- 共通 util は `src/output/human/*` を再利用するため diff は限定的
- `--rich` の出力 byte 表現は契約に含まない (UX 改善で随時変更)
- 絵文字を制御するための env `SLACK_CHAN_NO_EMOJI` を追加

## Related

- ADR-0001 (依存最小化方針)
- ADR-0013 (`--human` 再定義、案 A per-command renderer)
