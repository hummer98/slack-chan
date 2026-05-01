# ADR-0012: FTS5 日本語 tokenizer — `tokenize='trigram'` (builtin) を採用

- Status: Proposed
- Date: 2026-05-01
- Phase: 6（検索体験改善）
- 関連 ADR: 0001 (`bun:sqlite`)、後続 T025（本実装）
- PoC: `scripts/poc/fts-ja-tokenizer/`、results / evaluation は gitignore

## Context

`search --cached-only` で日本語クエリ（例: 「リマインド」「集う会」「宿泊費」）が
hit しない問題が実 Slack 環境で再現していた。原因は `messages_fts`
（`docs/seed.md` §4.2）が FTS5 デフォルトの `unicode61` tokenizer を使っており、
CJK 連続文字を 1 トークンとして扱うため、部分文字列クエリが索引にマッチしないこと。
本実装（T025）の手戻りを防ぐため、T024 で **PoC を実データに対して回し**、採用する
tokenizer 戦略を本 ADR で確定する。

### bun:sqlite probe 結果

PoC `scripts/poc/fts-ja-tokenizer/probe.ts` 実行結果（`probe.json` に永続化）:

| 項目 | 結果 |
|------|------|
| SQLite version | **3.51.0**（builtin trigram の要件 3.34+ を充足） |
| FTS5 利用可否 | yes |
| `tokenize='trigram'` (builtin) | **yes** — `CREATE VIRTUAL TABLE … USING fts5(x, tokenize='trigram')` 成功、CJK / ASCII 双方の MATCH 確認 |
| ICU 拡張 (`tokenize='icu …'`) | **no**（`no such tokenizer: icu`）— Bun 同梱 SQLite に ICU は未リンク |

### 評価セット

`scripts/poc/fts-ja-tokenizer/evaluation.json`（gitignore 対象、PII 含むため非公開）に
以下 5 クエリ × 実 cache.db 40 件の expected hits を確定:

| query | expected hits |
|-------|---------------|
| リマインド | 2 |
| 集う会 | 2 |
| 宿泊費 | 2 |
| KDG | 7 |
| test | 0 |

expected の確定は `text LIKE '%query%'` で行った。SQLite の LIKE は
**ASCII 部分のみ case-insensitive**（unicode は case-sensitive）。本評価では
全候補をこの「ASCII case-insensitive」基準に揃えるため、
unicode61 / 手動 gram / TinySegmenter は `LOWER()` 正規化 + index/query 双方の小文字化、
trigram-builtin は `tokenize='trigram case_sensitive 0'` を使用した。

## Decision

`messages_fts` の tokenizer を **FTS5 builtin trigram** に変更する。

```sql
CREATE VIRTUAL TABLE messages_fts USING fts5(
    text,
    content='messages',
    content_rowid='rowid',
    tokenize='trigram case_sensitive 0'
);
```

採用理由（PoC 結果の優先順位順）:

1. **精度が最高水準**: 5 クエリすべてで Precision = Recall = F1 = 1.00
   （original-40 データセット、`results/trigram-builtin.original-40.json`）。
2. **実装複雑度がほぼゼロ**: virtual table 定義に `tokenize='trigram'` を追記するだけ。
   INSERT / SELECT 側のテキストはそのままでよい。手動 gram のように
   アプリ層で gram 化する必要がない。
3. **配布影響ゼロ**: bun:sqlite に builtin、追加バイナリ・辞書なし。
4. **既存 `messages_fts` の `content='messages'` external content 構成と互換**
   （後述「Consequences §external content」参照）。
5. **3 文字未満クエリの fallback 戦略を T025 で吸収可能**: trigram は
   3 文字未満を MATCH 不能だが、`text LIKE '%q%'` への自動 fallback で対応する
   （PoC runner.ts 参照）。これは search コマンド側の責務として T025 で実装する。

## Comparison Matrix

精度数値は **original-40**（`results/<候補>.original-40.json`）、
速度数値は **repeat-1000**（同 `repeat-1000.json`、原 40 件 × 25 倍に複製した
合成データ）から取得。これは「精度は実データの discrete な expected hits で測り、
速度は messages 件数の桁感で測る」原則に従う（plan.md §4 参照）。

| 候補 | Precision | Recall | F1 | Index ms (1000) | Avg Query ms | 実装複雑度 | 配布影響 | Notes |
|------|-----------|--------|----|-----------------|--------------|------------|----------|-------|
| **trigram-builtin** | **1.00** | **1.00** | **1.00** | 102.7 | 0.13 | 最小（DDL 一行） | なし | **採用** |
| trigram-manual | 1.00 | 1.00 | 1.00 | 78.4 | 0.13 | 中（INSERT/検索で gram 化） | なし | 同精度・index やや軽量だが external content と相性悪 |
| bigram-manual | 1.00 | 1.00 | 1.00 | 61.0 | 0.10 | 中（同上） | なし | 同精度、index 最軽量だが手動 |
| tinysegmenter | 0.80 | 0.77 | 0.78 | 721.7 | 0.21 | 高（vendoring + JS 形態素処理） | 微（500 行 JS 同梱） | 「宿泊費」を取りこぼし。形態素境界依存 |
| unicode61（baseline） | 0.40 | 0.37 | 0.38 | 18.6 | 0.08 | 0 | なし | 日本語 3 クエリすべて 0 hit。問題の原因 |
| icu | n/a | n/a | n/a | n/a | n/a | — | — | bun:sqlite に拡張なし。実行不能 |

> **case-sensitivity の前提**: 全候補で「ASCII case-insensitive」に揃えた
> （unicode61 / 手動 gram / TinySegmenter は `LOWER()` 正規化、trigram-builtin は
> `case_sensitive 0`）。評価クエリ「test」「KDG」のスコアはこの前提に依存する。
> Unicode の case folding（例: 全角／半角）は本 PoC のスコープ外。T025 で
> 必要なら別途検討。

`unicode61` のサンプル「KDG」が precision 1.00 / recall 0.86 となっているのは、
1 件の expected が unicode61 の word boundary に引っかかったため（ASCII の
連続列内に hit する 6 件は取れたが、word の途中に埋まった 1 件が落ちた）。
`trigram-builtin` は 3-gram のため word boundary に依存せず 7/7 をすべて取得。

## Consequences

### バイナリ・索引サイズ

- バイナリ: **増分なし**。trigram は SQLite 標準 build に含まれる。
  bun:sqlite を `better-sqlite3` 等にスワップする必要なし（ADR-0001 維持）。
- 索引サイズ: PoC 1000 件で index 化に 102 ms。`unicode61` 比 +5.5 倍程度の
  時間がかかるが、絶対値は十分小さい。索引ファイルサイズは未測定だが、
  trigram は文字 3-gram すべてを posting list に持つため `unicode61` より
  概ね数倍に膨らむ見込み。実 cache.db スケール（10K〜100K msg 想定）でも
  数 MB 単位、配布バイナリには影響しない。T025 で `messages_fts` 再作成後の
  cache.db サイズを記録すること。

### 既存 cache 再 index 戦略

既存ユーザーの `~/.local/share/slack-chan/cache.db` は `unicode61` で構築された
`messages_fts` を持つため、tokenizer 変更時に再 index が必要。方針:

1. `src/storage/migrations/` に新規 SQL migration を追加:
   - `DROP TABLE messages_fts;`
   - `CREATE VIRTUAL TABLE messages_fts … tokenize='trigram case_sensitive 0' …`
   - `INSERT INTO messages_fts(messages_fts) VALUES('rebuild');`
2. `migrate.ts` の schema_versions が次回起動時に自動適用 → 透過的に再 index 完了。
3. messages 件数が大きいユーザでは `rebuild` に数百 ms 〜 秒オーダーかかる
   可能性がある。CLI 起動時のレイテンシに影響するなら、`sync` コマンド初回時
   への遅延適用 or プログレス表示を T025 で検討。

### external content (`content='messages'`) の継続

採用候補が **builtin trigram** なので、現行の external content 構成
（`content='messages', content_rowid='rowid'`）を**維持できる**。SQLite が
内部で gram 化するため、`messages` テーブルのテキストはそのまま保持してよい。
これは「INSERT 経路を二重化しなくて済む」点で運用上の利点が大きい。

> もし将来 recall 不足から手動 bigram/trigram に切り替える事態になった場合、
> external content と相性が悪い（gram 化テキストの置き場所を `messages.text` に
> するか別カラム / 別テーブルにするかで migration コストが変わる）。本 ADR では
> その将来分岐を **T025 への申し送り** に明記する。

### search コマンド側の必要変更（T025）

- **3 文字未満クエリの fallback**: trigram は `len(query) < 3` で MATCH 不能。
  PoC では `LIKE '%q%'` への fallback を実装した（runner.ts 参照）。
  T025 でも `src/cli/commands/search/fts.ts` のクエリ前処理に同等の分岐を入れる。
- **クエリ正規化**: `case_sensitive 0` で大文字小文字は SQLite 側が吸収するが、
  全角/半角・濁点位置などの正規化は別途必要なら `Intl.Segmenter` か独自正規化で
  対応する。本 PoC ではスコープ外。
- **`messages_fts MATCH` のクエリ構文**: trigram はトークンを
  `"phrase"` で囲む phrase 形式が安全（PoC で確認）。既存 `fts.ts` の
  `"escaped"` への変換ロジックはそのまま流用できる。

### 評価サンプルサイズの限界

- cache.db には messages 40 件しかなく、5 クエリ × 期待 0–7 hits の **discrete
  な評価**になっている。この状況で `trigram-builtin` が完璧なスコアを出した
  ことは「採用候補として十分」とは言えるが、「他候補との優劣を統計的に確定した」
  とは言いがたい。
- 速度数値 (repeat-1000) は同じ text を 25 回複製しているので「異なる text 多様性」
  は再現していない。実運用での index 時間は本 PoC + 数倍〜10 倍の桁で見積もる。
- 上記の不確実性は recall 不足が再発した場合の再評価トリガーとして
  「T025 への申し送り」に記録する。

## Rejected Alternatives

### unicode61（baseline、現状）

- 不採用理由: 日本語 3 クエリすべて recall 0。本 ADR 起票の動機そのもの。
- ASCII 略語クエリ（KDG）でも word boundary 依存で 1 件取りこぼし。

### bigram-manual / trigram-manual（手動 n-gram）

- 不採用理由: 精度は trigram-builtin と同点（P=R=F1=1.00）だが、
  - INSERT 時に gram 化したテキストを別カラム / 別テーブルに持つ必要があり、
    現行の external content 構成と相性が悪く migration コストが大きい。
  - 検索時もアプリ層でクエリを gram 化する責務が増える。
  - SQLite builtin にほぼ同じ機能があるのに自前で再実装する正当性が弱い。
- もし bun:sqlite が将来 SQLite を 3.34 未満にダウングレードする事態が起きれば、
  trigram-manual が次善候補（5.3）になる。

### TinySegmenter（vendored, BSD）

- 不採用理由:
  - F1=0.78 で trigram-builtin (1.00) に劣る。「宿泊費」を取りこぼした
    （形態素境界依存のため、複合語の中の部分一致が落ちる）。
  - index 化に 721 ms（trigram-builtin の 7 倍）。実 cache.db スケールで
    起動時レイテンシ悪化リスク。
  - 辞書なし純 JS なので配布影響は微小だが、precision/recall でトレードオフを
    正当化できない。
- vendoring の元: code4fukui/TinySegmenter @ `edc44b2d`（BSD-3-Clause）。
  コードは `scripts/poc/fts-ja-tokenizer/tokenizers/tinysegmenter-vendor.js`。
  PoC コードとして commit されるが、本流には取り込まれない。

### kuromoji.js / lindera-wasm（フル形態素解析）

- **未評価で見送り**。理由:
  - trigram-builtin が `recall ≥ 0.9 かつ precision ≥ 0.7`
    （実際は両方 1.00）を達成し、plan.md §7 ステップ ⑤ の判断軸により
    追加評価は不要と判定。
  - 辞書 5–10 MB の配布影響、PoC コストが他候補の 5 倍以上。
- **再評価トリガー**: 実運用で recall 不足が顕在化した場合（ユーザから
  「キーワードが見つからない」報告が複数件、または `search` の hit 率が
  低下するメトリクスを観測した場合）に、別タスクで kuromoji.js を 1 候補
  追加評価する。lindera-wasm は kuromoji が辞書サイズ的に問題になった場合の次候補。

### SQLite ICU tokenizer (`tokenize='icu …'`)

- 不採用理由: bun:sqlite (Bun 同梱 SQLite) は標準 build で ICU 拡張をリンクしていない
  （`no such tokenizer: icu` で確認済み）。`better-sqlite3` 側では
  ICU 拡張ありの SQLite を選べるが、それは ADR-0001（`bun:sqlite` 採用）を
  覆す変更で、コスト対効果が見合わない（本 ADR では trigram-builtin が
  十分な精度を出している）。
- **再評価トリガー**: 言語別検索（中国語・韓国語の混在）や ICU collation
  ベースの検索が必須要件になった場合のみ ADR-0001 の見直しと合わせて検討。

## T025 への申し送り

T025 (本実装タスク) で対応すべき項目を以下に列挙する:

### Migration

1. `src/storage/migrations/` に新 SQL migration ファイル（例: `0002__messages_fts_trigram.sql`）を追加。
2. 内容:
   ```sql
   DROP TABLE messages_fts;
   CREATE VIRTUAL TABLE messages_fts USING fts5(
       text,
       content='messages',
       content_rowid='rowid',
       tokenize='trigram case_sensitive 0'
   );
   INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
   ```
3. 既存 `0001__init.sql` の messages_fts 定義も同等に更新（新規 cache 用）。
4. `src/storage/migrate.ts` の schema_versions による自動適用パスを通す。

### 既存ユーザーの cache 再 index 戦略

- 次回 CLI 起動時の migration で透過的に rebuild される（`INSERT INTO messages_fts(messages_fts) VALUES('rebuild')`）。
- messages 件数が大きいユーザでは数百 ms 〜 秒オーダーかかる可能性。
  必要なら `sync` 初回まで遅延、または `slack-chan cache rebuild` 手動コマンドを
  追加することを検討。

### search コマンド側の変更

- `src/cli/commands/search/fts.ts` のクエリ前処理に **3 文字未満クエリの
  LIKE fallback** を追加。例:
  ```ts
  if ([...query].length < 3) {
      // LIKE-based fallback（messages テーブル直接検索）
      return likeSearch(db, query);
  }
  return ftsSearch(db, query);
  ```
- 必要ならクエリ正規化（NFKC、`toLowerCase()` 等）を追加。
- bm25 ランキングは trigram でも動作するため、現行の
  `ORDER BY bm25(messages_fts) ASC` はそのまま使える。

### 残課題（recall 不足が顕在化した場合の再評価）

1. **kuromoji.js の追加評価**: 実運用で recall 不足が複数報告 → 別タスクで PoC 追加。
2. **手動 bigram への切り替え**: kuromoji も不採用となった場合、
   bigram-manual を再評価。ただし external content 構成変更の migration が必要。
3. **ICU 必須要件が出た場合**: ADR-0001 の見直しと合わせて検討（コスト極大）。

### 残課題（評価ギャップ）

- PoC 評価サンプルが 40 messages × 5 queries と少ない。T025 完了後、
  実運用 1 ヶ月程度で「期待しない 0 hit」「ノイズ過多」の報告が出ていないか
  メトリクス or ユーザフィードバックで確認すること。
- Unicode 正規化（全角／半角、ひらがな／カタカナ揺らぎ）は本 PoC のスコープ外。
  必要性が出たら別 ADR で検討。

## 参考

- PoC コード: `scripts/poc/fts-ja-tokenizer/`
- PoC 結果: `scripts/poc/fts-ja-tokenizer/results/*.json`（gitignore、PII 含む）
- probe 結果: `scripts/poc/fts-ja-tokenizer/probe.ts` 出力 / task `<OUTPUT_DIR>/probe.json`
- task: `.team/tasks/024-t024-poc-fts5-tokenizer/task.md`
- plan: `.team/tasks/024-t024-poc-fts5-tokenizer/runs/task-024-1777596377/plan.md`
