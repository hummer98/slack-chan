# PoC: FTS5 日本語 tokenizer 候補比較 (T024)

ADR-0012 (`docs/decisions/0012-fts-ja-tokenizer.md`) の判断材料を作るための PoC。
本ディレクトリのコードは **PoC 専用**であり、本流コード (`src/`) からは参照しない。

## 目的

`search --cached-only` で日本語クエリ（「リマインド」「集う会」等）が hit しない
問題を解決するため、`messages_fts` で採用すべき tokenizer を比較する。

## 実行方法

### 1. 評価データの準備（PII 含むため commit 禁止）

```bash
bun run scripts/poc/fts-ja-tokenizer/build-evaluation.ts
```

`~/.local/share/slack-chan/cache.db` を **read-only** で開いて、5 つのクエリ
（「リマインド」「集う会」「宿泊費」「KDG」「test」）の expected hits を確定し
`evaluation.json` に書き出す。`scripts/poc/.gitignore` で除外される。

### 2. bun:sqlite の能力 probe

```bash
bun run scripts/poc/fts-ja-tokenizer/probe.ts /path/to/probe.json
```

- SQLite version
- FTS5 builtin trigram の可否
- ICU 拡張の可否

を確認し、人間可読 + JSON で出力。第 2 引数の path に書き出す。

### 3. 候補比較を実行

```bash
# 精度評価 (original 40 messages)
bun run scripts/poc/fts-ja-tokenizer/runner.ts

# 速度評価 (40 → 1000 messages に複製)
bun run scripts/poc/fts-ja-tokenizer/runner.ts --repeat 25

# 特定候補だけ
bun run scripts/poc/fts-ja-tokenizer/runner.ts --only trigram-builtin,unicode61
```

stdout に markdown 表、`results/<候補>.<dataset>.json` に詳細 JSON を出す。
`results/` も gitignore 対象。

## 出力の読み方

ADR の運用上の取り決め:

- **精度数値（Precision/Recall/F1）は `original-40` データセットの値**
- **速度数値（Index ms / Avg Query ms）は `repeat-1000` データセットの値**

理由は ADR-0012 の "Comparison Matrix" 直前と "評価サンプルサイズの限界" 参照。

## 評価候補

| ファイル | 概要 |
|---|---|
| `tokenizers/unicode61.ts` | FTS5 default。CJK 1 トークン化のベースライン |
| `tokenizers/bigram-manual.ts` | 文字 2-gram を手動分割して unicode61 に流す |
| `tokenizers/trigram-manual.ts` | 同上の 3-gram 版 |
| `tokenizers/trigram-builtin.ts` | SQLite 3.34+ の builtin trigram tokenizer |
| `tokenizers/tinysegmenter.ts` | 500 行 純 JS 形態素解析（vendored, BSD） |
| `tokenizers/icu.ts` | bun:sqlite に拡張がないので available()=false |

## 安全装置

- `runner.ts` / `build-evaluation.ts` は cache.db を **`?mode=ro` URI + `readonly: true`** で開く
- 一時 db は `os.tmpdir()` 配下に `slackchan-poc-fts-*.db` で作り、終了時に削除
- `evaluation.json` / `results/` / `*.db` は `scripts/poc/.gitignore` で除外
- 完了後 `sqlite3 ~/.local/share/slack-chan/cache.db 'PRAGMA integrity_check;'` で OK 確認

## ファイル構成

```
scripts/poc/
├── .gitignore
└── fts-ja-tokenizer/
    ├── README.md             ← 本ファイル
    ├── probe.ts              ← bun:sqlite の能力 probe
    ├── build-evaluation.ts   ← evaluation.json 生成 (PII を含むため commit 禁止)
    ├── runner.ts             ← 共通ランナー
    ├── types.ts              ← 共通インタフェース
    ├── util.ts               ← ngram / FTS5 phrase 等のユーティリティ
    ├── tokenizers/
    │   ├── unicode61.ts
    │   ├── bigram-manual.ts
    │   ├── trigram-manual.ts
    │   ├── trigram-builtin.ts
    │   ├── tinysegmenter.ts
    │   ├── tinysegmenter-vendor.js  ← vendored (BSD, code4fukui/TinySegmenter @ edc44b2)
    │   └── icu.ts
    ├── evaluation.json       ← gitignore（PII）
    └── results/              ← gitignore（PII）
```
