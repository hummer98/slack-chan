# slack-chan — Seed Document

このドキュメントは `slack-chan` プロジェクトの**初期構想を別セッションへ申し送るためのハンドオフ文書**です。
yamamoto (GitHub: hummer98) と Claude Code の対話で固めた設計判断・調査結果・未決事項を網羅しています。

実装フェーズはこのリポジトリ内の Claude Code セッションで継続します。

---

## 1. なぜ作るのか — 解決したい課題

AI エージェント (Claude Code) を日常開発フローに組み込むうえで、Slack を以下 2 用途のインターフェースとして使いたい:

1. **コンテキストとして read**: Claude が作業前にチャンネル/スレッドを参照して背景を把握
2. **報告として write**: Claude が作業結果・進捗を Slack に投稿

これに必要な要件:

| # | 要件 | 理由 |
|---|---|---|
| R1 | Claude Code plugin (SKILL.md) で配布される | Claude が自然言語で呼べる必要がある |
| R2 | 複数 Slack workspace に同時アクセスできる | 個人/業務/コミュニティ等で workspace が分かれる |
| R3 | デフォルト workspace/channel が config or 環境変数で指定できる | 毎回引数指定は面倒、ヒトの直感に近づける |
| R4 | チャンネル毎の read キャッシュがある | 過去ログはほぼ書き換わらない。毎回 API 叩くのは無駄、レート制限も逼迫 |

**Slack で許可されている API は可能な限り網羅**したい (`conversations.*`, `chat.*`, `users.*`, `files.*`, `reactions.*`, `views.*` 等)。

---

## 2. 既存ツール調査結果 — なぜ自作なのか

会話のなかで以下を網羅的に調査した。**4 要件を全て満たすツールは存在しない**。

### 2.1 候補と評価

| ツール | R1 SKILL | R2 multi-WS | R3 default | R4 cache | 公式 | 備考 |
|---|---|---|---|---|---|---|
| `slackapi/slack-mcp-plugin` | ✅ skill+command | ❌ OAuth 1WS | ❌ | ❌ | ✅ Slack 公式 org | hosted MCP `mcp.slack.com/mcp` 接続。提供 API は subset |
| `retrodigio/claude-channel-slack` | ✅ 3 skills | ❌ 1 Slack app | △ routes.json | ❌ | ❌ | 用途違い (Slack→subagent dispatch) |
| `korotovsky/slack-mcp-server` | ❌ MCP のみ | ❌ 1 process 1 WS | ❌ | △ users/channels metadata のみ | ❌ | xoxc/xoxd 売り → ToS 違反コース |
| `Multivariate-AI-Inc/slack-mcp-server` | ❌ MCP のみ | ✅ `add_workspace` tool | △ | ❌ | ❌ | repo 削除 or アクセス不可 |
| `shaharia-lab/slackcli` | ❌ 純 CLI | ✅ `auth login --workspace-name` | △ default workspace のみ (channel 不可) | ❌ (self-update cache のみ) | ❌ unofficial 明言 | **最も近い**。`@slack/web-api` ベース、bun コンパイル、xoxp/xoxb 対応。ただし Claude plugin 化されていない、history cache なし、API は subset |
| Composio `slack-automation` skill | ✅ SKILL.md 形式 | ✅ | ✅ | ❌ | ❌ Rube MCP (Composio SaaS) 依存 | 「公式以外に依存しない」方針に反する |
| Anthropic `claude-plugins-official` | — | — | — | — | ✅ | Slack 関連は `slackapi/slack-mcp-plugin` を marketplace 登録のみ。Anthropic 自前の Slack skill は無し |

### 2.2 結論

- **MCP 単独**では R1 を満たさない (SKILL レイヤが無い)。
- **公式 plugin** は R2/R3/R4 を満たさない。乗っかってもラッパーは結局必要。
- **slackcli** は近いが、3rd party 依存 + R1/R3 (channel default)/R4 が欠ける。
- Composio 系は SaaS 依存で除外。

→ **薄い自作 OSS が最短**。

### 2.3 MCP の context 圧迫について

ユーザーから「ユーザースコープ MCP は context 圧迫しないか」の懸念があった。検証結果:

- 現在の Claude Code は MCP ツールを **deferred tools** として扱う (このセッション中の system reminder で確認済み)。
- 実体: ツール名のみ context にロードされ、JSONSchema は `ToolSearch` で要求時のみロード。
- **ユーザースコープに置いてもコストは数十トークン × ツール数程度**。気にしなくて良い。
- それでも消したい場合は project の `.claude/settings.local.json` に `disabledMcpjsonServers: [...]` を書く。

---

## 3. 設計判断 (固まったもの)

### 3.1 言語・ランタイム
- **TypeScript + Bun**
  - Bun コンパイルで単一バイナリ配布可
  - `slackcli` 等の前例あり、Slack 公式 SDK との相性良
- 依存パッケージは **`@slack/web-api` (Slack 公式 SDK) のみ** を原則。CLI フレームワーク等は最小限に検討。

### 3.2 ストレージ
- **SQLite (better-sqlite3)**
  - 単一ファイル、ロック不要、検索性高
  - FTS5 でメッセージ全文検索可能
  - JSON より構造化、KVS より検索性高い

### 3.3 トークン管理
- **デフォルト: macOS Keychain** (`security` コマンド連携)
- **fallback: 平文ファイル** (`~/.config/slack-chan/tokens.json`、chmod 600)
- 切替: `slack-chan config tokens-store keychain|file`
- Linux: `secret-tool` (libsecret) 連携を検討
- **使用許可するトークン**: `xoxp` (User OAuth) と `xoxb` (Bot) のみ
- **拒否するトークン**: `xoxc` / `xoxd` (ブラウザ session) — Slack AUP 明確違反

### 3.4 出力形式
- **デフォルト: JSONL** (AI が読みやすい)
- `--toon`: TOON 形式 (調査要、AI-readable な軽量フォーマット候補)
- `--human`: 人間が CLI で読む整形 (タイムライン / 表 / プロフィールカード /
  KV / 単位付き数値 / 相対時刻 / TTY 自動色判定)。詳細・採用判断は ADR-0013
  を参照: [`decisions/0013-output-format-roles.md`](decisions/0013-output-format-roles.md)

### 3.5 キャッシュ戦略

#### 3.5.1 通常の read
1. SQLite の `messages` テーブルに最後の `ts` を問い合わせ
2. `conversations.history` を `oldest=last_ts` で増分 fetch
3. 取得したメッセージを SQLite に upsert
4. `--refresh` 時は全件再取得 (テーブル truncate or `oldest=0`)

#### 3.5.2 編集・削除メッセージの追従
- 増分 fetch だけでは編集を検出できない (`ts` 不変)。
- **直近 N 日 (default: 7d) or N 件 (default: 100)** を毎回 refetch して `edited` / `deleted` を反映。
- それ以前は immutable とみなす (write-once)。
- `--full-edit-scan` でこの window を無視して全件チェックも可能に。

#### 3.5.3 スレッド (thread_ts)
- `conversations.history` は親メッセージのみ返す。
- リプライは `conversations.replies` で別取得。
- **戦略: 親だけ cache、リプライはオンデマンド + 取得後 cache に書き戻し**。
- 理由: スレッドは事後追加されやすく "ほぼ書き換わらない" 前提が崩れる。事前一括 cache はサイズ・整合性ともに不利。

### 3.6 配布優先順位
1. **Claude Code plugin marketplace** (最優先)
2. **npm** (`@hummer98/slack-chan` または `slack-chan`)
3. **Homebrew tap** (`hummer98/tap`)
   - bun コンパイル済みバイナリを Release assets に置く

---

## 4. アーキテクチャ概要

```
┌──────────────────────────────────────────┐
│ Claude Code  ── invokes ──> SKILL.md     │
└──────────────────────────────────────────┘
                  │ Bash 経由
                  ▼
┌──────────────────────────────────────────┐
│ slack-chan CLI  (Bun + TypeScript)       │
│  ├─ config (workspace/token/default)     │
│  ├─ read / dm / search                   │
│  ├─ post / dm send                       │
│  ├─ download (files)                     │
│  ├─ user (profile)                       │
│  └─ api (生 Slack API 直叩き脱出ハッチ)  │
└──────────────────────────────────────────┘
       │             │             │
       ▼             ▼             ▼
   ┌────────┐   ┌────────┐   ┌─────────────┐
   │SQLite  │   │Keychain│   │Slack Web API│
   │+ FTS5  │   │or file │   │(@slack/sdk) │
   └────────┘   └────────┘   └─────────────┘
```

### 4.1 ディレクトリ配置 (案)

```
~/.config/slack-chan/
  config.toml           # default workspace, default channels per workspace, output prefs
  tokens.json           # (file mode 時のみ) chmod 600

~/.local/share/slack-chan/
  cache.db              # SQLite メッセージ履歴
  files/<ws>/<file_id>  # download 済み添付ファイル

~/.cache/slack-chan/
  (一時ファイル)
```

XDG Base Directory に従う。macOS でも `$XDG_*` 設定があればそれを尊重。

### 4.2 SQLite スキーマ (DDL ドラフト)

```sql
CREATE TABLE workspaces (
  team_id        TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT,
  default_channel TEXT,
  added_at       INTEGER NOT NULL  -- unix ts
);

CREATE TABLE channels (
  team_id        TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  name           TEXT,
  type           TEXT,             -- public_channel / private_channel / im / mpim
  topic          TEXT,
  purpose        TEXT,
  is_member      INTEGER,
  last_synced_ts TEXT,             -- conversations.history の最後の ts
  fetched_at     INTEGER,
  PRIMARY KEY (team_id, channel_id)
);

CREATE TABLE messages (
  team_id     TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  ts          TEXT NOT NULL,        -- Slack の "1234567890.123456"
  thread_ts   TEXT,                 -- 親 ts (スレッド返信時)
  user_id     TEXT,
  type        TEXT,                 -- message / etc
  subtype     TEXT,                 -- channel_join, message_changed, etc
  text        TEXT,
  edited_ts   TEXT,                 -- 最終編集の ts
  deleted     INTEGER DEFAULT 0,
  raw_json    TEXT NOT NULL,        -- 原 JSON 全体
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (team_id, channel_id, ts)
);

CREATE INDEX idx_messages_thread ON messages(team_id, channel_id, thread_ts);
CREATE INDEX idx_messages_user ON messages(team_id, user_id);
CREATE INDEX idx_messages_fetched ON messages(team_id, channel_id, fetched_at);

-- 全文検索
CREATE VIRTUAL TABLE messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid'
);

CREATE TABLE users (
  team_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  name         TEXT,
  real_name    TEXT,
  email        TEXT,
  profile_json TEXT,
  fetched_at   INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE files (
  team_id     TEXT NOT NULL,
  file_id     TEXT NOT NULL,
  channel_id  TEXT,
  ts          TEXT,                 -- 紐付くメッセージの ts
  name        TEXT,
  mimetype    TEXT,
  size        INTEGER,
  url_private TEXT,
  local_path  TEXT,                 -- download 済みなら絶対パス
  downloaded_at INTEGER,
  raw_json    TEXT,
  PRIMARY KEY (team_id, file_id)
);
```

### 4.3 CLI コマンド構造 (案)

```
slack-chan config
  workspace add --token=xoxp-... [--name=...]
  workspace list
  workspace remove <team_id>
  workspace set-default <team_id>
  channel set-default <ws> <channel_id_or_name>
  tokens-store keychain|file
  show

slack-chan read <channel> [--workspace=<ws>] [--limit=N] [--since=7d]
                          [--thread=<ts>] [--refresh] [--json|--toon|--human]
slack-chan post <channel> <text> [--workspace=<ws>] [--thread=<ts>]
                                 [--file=<path>] [--blocks=<json>]
slack-chan download <ts> [--workspace=<ws>] [--channel=<ch>] [--out=<dir>]

slack-chan dm <user> <text>           # 投稿
slack-chan dm <user> --read           # 履歴 (cache 付き)

slack-chan user <id|email|@name>      # プロフィール
slack-chan search <query> [--in=<ch>] [--from=<user>] [--cached-only]

slack-chan api <method> [k=v ...]     # 生 Slack API 脱出ハッチ
                                      # 例: slack-chan api conversations.info channel=C123

slack-chan sync <channel>             # 明示的にキャッシュ更新
slack-chan stats                      # キャッシュ統計
```

### 4.4 SKILL.md (Claude Code plugin) のスケルトン

`~/.claude/plugins/slack-chan/SKILL.md` に相当する内容:

```markdown
---
name: slack-chan
description: Read and post Slack messages with multi-workspace support, default channels, and persistent cache. Use when reading Slack channel history as context, posting reports/notifications, fetching user profiles, downloading attachments, or any Slack Web API operation. The CLI handles all caching and token management.
allowed-tools:
  - Bash(slack-chan:*)
---

# slack-chan — Slack interface for Claude

## When to use
- Need Slack channel history as context → `slack-chan read <channel>`
- Posting work updates → `slack-chan post <channel> <text>`
- Looking up a user → `slack-chan user <id_or_email>`
- DMs, file downloads, search, etc.

## Defaults
Workspace and channel defaults are read from `~/.config/slack-chan/config.toml`
and env vars `SLACK_CHAN_DEFAULT_WORKSPACE` / `SLACK_CHAN_DEFAULT_CHANNEL`.
Don't ask the user which workspace to use unless they explicitly mention multiple.

## Output format
Default JSONL — parse it directly. Use `--human` only when the user wants to see
the output themselves (per ADR-0013, `--human` produces tailored renderings:
timeline for `read` / `dm --read` / `search`, profile card for `user`, table
for `config workspace list`, KV for `stats`, file list for `download`, and a
pretty-JSON fallback for `api` / `post` / `dm --post` / `sync`).

## Cache semantics
- Recent N days (default 7) refetched each call → edits/deletes reflected
- Older messages immutable
- `--refresh` for full refetch
- Threads: parent cached, replies fetched on-demand

## Escape hatch
If a Slack API method isn't covered by a dedicated subcommand, use:
  slack-chan api <method> [key=value ...]
Reference: https://api.slack.com/methods
```

---

## 5. 最低限の機能スコープ (MVP)

ユーザー指定:

- [x] channel read (cache 付き)
  - [x] 添付ファイル download
- [x] channel read/write
  - [x] 写真・添付ファイル送信
- [x] DM 対応 (read/write)
- [x] user/profile 取得

加えて私が必須と判断する機能:

- [ ] config/workspace 管理 (R3 のため)
- [ ] generic `api` サブコマンド (全 API 網羅のため)
- [ ] search (read 用途で必須)
- [ ] cache 統計 + sync 明示

---

## 6. ToS / セキュリティ前提

### 6.1 Slack 側
- Slack API Terms of Service / Acceptable Use Policy 遵守。
- 利用可能トークン: `xoxp` (User OAuth)、`xoxb` (Bot)。
- **使わないトークン**: `xoxc` / `xoxd` (ブラウザ session 抽出) — AUP 明確違反、アカウント停止リスク。
  - `slackcli` や `korotovsky` がサポートしているが本ツールでは**意図的に省く**。
- ワークスペース admin の MCP/App 承認が前提となるシナリオを README に明記。
- レート制限 (Tier 1〜4) を尊重。indicator 出す。

### 6.2 トークン保管
- Keychain がデフォルト。
- ファイル fallback は chmod 600 強制、parent dir も 700。
- ログ出力には絶対に token を含めない。
- ER ログでも redact 必須。

---

## 7. 申し送り (次セッションでの未決事項)

### 7.1 開発プロセス
- **Kiro spec-driven development を採用するか未決**
  - blog リポジトリの CLAUDE.md は Kiro 流 3 phase (requirements → design → tasks → impl) を要求するが、これは blog repo のローカルポリシー
  - slack-chan は新規 OSS、yamamoto から「あとで決定」と明示あり
  - 推奨: 採用するなら最初の `/kiro:spec-init` は本 seed.md を入力にする

### 7.2 命名・パッケージ
- 競合調査済み:
  - npm `slack-chan`: ✅ 空き
  - PyPI / crates.io / Homebrew: ✅ 空き
  - GitHub user/org `slack-chan`: ✅ 空き
  - Anthropic claude-plugins-official marketplace: ✅ 該当なし
- 懸念 (注意して進めること):
  - `slack-channel` 系の repo が大量にあり検索ノイズになりうる
  - `jeremylongshore/claude-code-slack-channel` (2026-04-28 作成) と機能領域近接 — 差別化を README で明示すべき
  - 英語圏で "slack-channel の typo" と読まれるリスク

### 7.3 出力形式の詳細
- TOON 形式 (Token-Oriented Object Notation 等) の最新仕様調査が必要
- `--human` の整形仕様は ADR-0013 で確定
  ([`decisions/0013-output-format-roles.md`](decisions/0013-output-format-roles.md)):
  zero-dep の `src/output/human/` 配下 (`timeline.ts` / `profile-card.ts` /
  `table.ts` / `kv-list.ts` / `format.ts`) と既存 `src/output/ansi.ts` で実装。
  外部ライブラリは追加しない方針 (ADR-0001)。

### 7.4 マルチプラットフォーム
- macOS Keychain は `security` コマンド前提。Linux Secret Service はどうするか?
- Windows サポートはどこまで? (Bun の Windows ビルドは alpha)

### 7.5 認証フロー
- ユーザーが `xoxp` token を取る手順を README に書く必要あり
- 自前 Slack App テンプレ提供 (manifest.yml) も検討

### 7.6 配布パイプライン
- GitHub Actions で Release tag → 各 OS 向け bun compile → Release asset → Homebrew tap update
- Claude plugin marketplace への登録手続き調査
  - `anthropics/claude-plugins-official` への PR 作成 (`marketplace.json` への entry 追加) ?
  - それとも独自 marketplace で公開?

### 7.7 テスト戦略
- Slack API モックライブラリ調査
- E2E は録画モード (`nock` 等) で再生
- CI 用に sandbox workspace 用意? (個人プロジェクトなら不要かも)

---

## 8. 関連リンク

- 開発者: [@hummer98](https://github.com/hummer98)
- 関連 OSS: [hummer98/using-cmux](https://github.com/hummer98/using-cmux) (cmux 操作 skill)
- Slack Web API: https://api.slack.com/methods
- Slack 公式 SDK: https://github.com/slackapi/node-slack-sdk (`@slack/web-api`)
- Claude Code Plugins ドキュメント: https://code.claude.com/docs/en/plugins
- 比較対象 OSS:
  - https://github.com/slackapi/slack-mcp-plugin
  - https://github.com/shaharia-lab/slackcli
  - https://github.com/korotovsky/slack-mcp-server
  - https://github.com/retrodigio/claude-channel-slack
  - https://github.com/anthropics/claude-plugins-official

---

## 9. このドキュメントの位置づけ

- これは **設計の出発点** (seed) であり、確定仕様ではない。
- 実装中に判断が変わったら、本ドキュメントを更新するか、別途 `docs/decisions/` に ADR を追加すること。
- 次セッションの最初にこの seed.md を必ず読んでから着手する。
