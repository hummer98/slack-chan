# Getting started — Slack App セットアップ

このドキュメントは、slack-chan を実際の Slack ワークスペースに繋ぐために必要な
**Slack App の作成 → `xoxp` (User OAuth) / `xoxb` (Bot) トークン取得 → slack-chan への
登録** までを一気通貫で説明します。所要時間は 10〜15 分程度です。

> **Phase 1 時点の注意**: `slack-chan` の CLI はまだ `--version` / `--help` のみ
> です。token を取得しても、実際の登録コマンド (`slack-chan config workspace add`)
> は **Phase 2 で実装予定** です。本ドキュメントは「先に App 側を準備しておきたい」
> 人向けの一次資料として位置付けています。

## 前提

- **対象読者**: Slack ワークスペースの管理者、または App 作成 / インストール権限を
  持つメンバー。
- **必要環境**:
  - 対象 Slack ワークスペースへのログイン (ブラウザ)
  - `slack-chan` (Phase 1 時点では `bun run dev -- --version` で動作確認のみ可能)
- **ワークスペースの App 承認ポリシーを確認**:
  ワークスペース管理者が App インストールに承認制を敷いている場合、
  下記ステップ 2「Install to Workspace」で承認待ちになります。事前に
  `https://<your-workspace>.slack.com/apps/manage` にアクセスして
  App リクエストの可否 (= 自分で install できるか / admin への申請が必要か) を
  確認してください。詳細な ToS 上の前提は [`docs/seed.md` §6.1](./seed.md#61-slack-側) を参照。

## ステップ 1 — manifest から Slack App を作成

1. https://api.slack.com/apps を開き **"Create New App"** をクリック。
2. **"From a manifest"** を選択。
3. **対象 workspace** を選択 (複数所属している場合は注意)。
4. manifest を貼り付ける欄に [`examples/slack-app-manifest.yml`](../examples/slack-app-manifest.yml)
   の中身をそのままコピペします。

   - YAML / JSON のどちらでも貼り付け可能ですが、本リポジトリでは YAML 版を
     正本として配布しています。
   - 各 scope の意味を確認したい場合は、コメント付き解説版
     [`examples/slack-app-manifest.commented.yml`](../examples/slack-app-manifest.commented.yml)
     を参照してください (Slack UI はコメントを保存時に剥がすため、UI に貼るのは
     コメント無しの方を推奨)。
5. **"Next"** で内容のサマリを確認 → **"Create"** で App が作成されます。

> このタイミングではまだトークンは発行されません (App の "ガワ" だけができた状態)。

## ステップ 2 — Bot Token (xoxb) を取得

1. 左メニューから **"Install App"** を開きます。
2. **"Install to Workspace"** をクリック。
3. 承認画面で **要求される scope の一覧** が表示されるので確認します
   (一覧の意味は後述の [§ Scope 一覧と用途](#scope-一覧と用途) を参照)。
4. **"Allow"** で承認すると、画面に以下の 2 種類のトークンが表示されます:
   - **Bot User OAuth Token** — `xoxb-` で始まる文字列
   - **User OAuth Token** — `xoxp-` で始まる文字列 (次のステップで扱う)
5. `xoxb-...` を控えます。

> **トークンの取り扱い注意**:
> - **絶対に Git にコミットしない** (`.env` も含めて避ける)。
> - **ターミナル履歴 / ログに残さない** (`echo` 等で出力しない)。
> - 推奨保管先は OS の secret store (macOS Keychain / Linux Secret Service)。
>   slack-chan は Phase 2 で Keychain を default 保管先として実装予定です。
>   詳細は [`docs/seed.md` §3.3](./seed.md#33-トークン管理) を参照。

## ステップ 3 — User OAuth Token (xoxp) を取得

ステップ 2 と同じ "Install App" ページで、**User OAuth Token** (`xoxp-...`) も
表示されています。これも控えてください。

> ⚠️ **xoxp はあなた本人として Slack を操作する強権限トークンです**
>
> - 投稿は **あなた本人のアバター / 名前** で行われ、Slack 上の監査ログにも
>   本人として記録されます。
> - **DM 履歴を読み取れます** — あなたが参加している全ての channel / private channel
>   / 1:1 DM が対象です。
> - 漏洩は **個人 Slack アカウントの完全な乗っ取りに等しい** ため、扱いを誤ると
>   ワークスペース管理者から個人アカウントを suspension される可能性があります。
> - Keychain 等の secret store に保存し、平文ファイルやリポジトリに置かないでください。

xoxp が必要な動機:

- `search.messages` / `search.files` などの **検索系 API は User Token 専用** です
  (Bot Token では呼べません)。slack-chan の `search` サブコマンドはこれを使うため、
  検索を使うなら xoxp が必須です。
- 自分しか参加していない private channel / DM を読みたい場合も xoxp が必要です。

逆に「投稿だけしたい」「読まれて困る情報がある」場合は xoxb のみで運用しても
構いません。

## ステップ 4 — slack-chan に token を登録

> **重要**: 以下のサブコマンドは **Phase 2 で実装予定** です。Phase 1 時点
> (現在のリポジトリ状態) では CLI に `--version` / `--help` のみが実装されており、
> 下記コマンドはまだ動きません。Phase 2 完了時に本ドキュメントを更新します。

想定コマンド (Phase 2 で実装予定):

```sh
slack-chan config workspace add --token=xoxp-...   # User OAuth
slack-chan config workspace add --token=xoxb-...   # Bot
```

- token の判定: 先頭プレフィックス (`xoxp-` / `xoxb-`) で User か Bot かを自動判別。
- **`xoxc-` / `xoxd-` (ブラウザ session 抽出系) は境界で reject** されます
  (詳細は次節)。
- 保管先 (Keychain / file) の切替は別サブコマンド `slack-chan config tokens-store
  keychain|file` で行う想定です。詳細は [`docs/seed.md` §3.3](./seed.md#33-トークン管理) を参照。

**Phase 1 暫定の代替策について**: 「`~/.config/slack-chan/tokens.json` を直接編集
すれば動くのでは？」と思うかもしれませんが、Phase 2 で確定するスキーマと矛盾する
可能性があるため、**直接編集は推奨しません**。Phase 2 のリリースを待ってください。

### 複数 workspace に slack-chan を入れる場合

slack-chan は multi-workspace 運用を前提に設計されています。複数のワークスペース
で使いたい場合の手順:

1. **各 workspace で個別に App を作成** — 同じ
   [`examples/slack-app-manifest.yml`](../examples/slack-app-manifest.yml) を
   それぞれの workspace の "Create from manifest" UI に貼り付けて App を作成
   します (App 自体はワークスペース単位なので使い回しはできません)。
2. **各 App の Install で得たトークンを個別に登録** — Phase 2 以降、
   `slack-chan config workspace add --name=<任意のラベル> --token=xoxp-...`
   のように workspace 名を付けて複数登録できる予定です。
3. App を Slack App Directory に **Distribute (公開) する必要はありません**。
   slack-chan は private-install のみを想定しています。

## Scope 一覧と用途

slack-chan が要求する scope の意味と、対応するサブコマンド (Phase 2 以降で実装) を
まとめます。manifest と完全に同じ並び順です。

### Bot Token Scopes (`oauth_config.scopes.bot`)

| Scope | 用途 (slack-chan 内) | 1 行説明 |
|---|---|---|
| `channels:read` | `read` / `sync` で公開チャンネル一覧を引く | 公開チャンネルのメタデータを取得 |
| `channels:history` | `read` / `sync` の履歴 fetch | 公開チャンネルのメッセージ履歴を読む |
| `groups:read` | `read` でプライベートチャンネル一覧 | 招待されているプライベートチャンネルのメタデータを取得 |
| `groups:history` | `read` の履歴 fetch | プライベートチャンネルのメッセージ履歴を読む |
| `im:read` | `dm --read` で DM チャンネル一覧 | Bot との 1:1 DM 一覧を取得 |
| `im:history` | `dm --read` の履歴 | Bot との DM 履歴を読む |
| `im:write` | `dm` 投稿 | Bot からユーザーへ DM を送る |
| `chat:write` | `post` の中核 | チャンネル / DM へメッセージを投稿 |
| `chat:write.public` | 招待されていない public ch への post | Bot が member でない公開チャンネルにも投稿可能。誤爆防止のため `post` コマンド側で明示確認を推奨 |
| `files:read` | `download` | アップロード済みファイルのメタデータと bytes を取得 |
| `files:write` | `post --file=` | ファイルをアップロードしてメッセージに添付 |
| `users:read` | `user` サブコマンド / mention 解決 | ワークスペースのユーザー一覧 / プロフィールを読む |
| `users:read.email` | `user --email=` | ユーザーの email を取得 (admin 設定により拒否される場合あり) |
| `users.profile:read` | プロフィール詳細 | カスタムフィールド (社内 ID 連携など) を含むプロフィールを読む。社内ツール連携で必要になるケースを想定して採用 |
| `reactions:read` | (任意) `read` 出力にリアクションを含める | メッセージのリアクション情報を読む |
| `emoji:read` | (任意) カスタム絵文字解決 | ワークスペースのカスタム絵文字一覧を取得 |

### User Token Scopes (`oauth_config.scopes.user`)

User OAuth でしか叩けない、もしくは「本人として動かすべき」API のみ列挙します。

| Scope | 用途 | 1 行説明 |
|---|---|---|
| `search:read` | `search` サブコマンド (**xoxp 必須**) | `search.messages` / `search.files` を実行 (Bot Token では不可) |
| `channels:history` | User として履歴を読む | 自分が参加する公開チャンネルの履歴を読む |
| `groups:history` | 同上 (private) | 自分が参加するプライベートチャンネルの履歴を読む |
| `im:history` | 自分の DM 履歴 | 自分が参加する DM の履歴を読む |
| `chat:write` | 本人として投稿 | 自分のアバター / 名前で投稿 (投稿は本人として記録される) |
| `files:read` | 自分が見られるファイル | 自分の閲覧権限内のファイルを取得 |
| `files:write` | 本人としてファイル添付 | 本人としてファイルをアップロード |
| `users:read` | ユーザー検索 | ユーザー一覧を読む |
| `users.profile:read` | プロフィール | プロフィールを読む |

> **xoxp の取り扱いについて (再掲)**: `xoxp-` は **あなた本人として Slack を操作
> するトークン** です。投稿は本人として記録され、本人が読める DM もすべて読める
> ため、漏洩は個人アカウントの完全な乗っ取りに等しい。Keychain への保存
> (`slack-chan config tokens-store keychain`、Phase 2 で実装予定) と `.gitignore`
> 経由のコミット防止を必ず守ってください。

### MVP では採用しない scope (参考)

以下は manifest にあえて含めていません (必要になったら別 PR で追加):

- `mpim:read` / `mpim:history` / `mpim:write` — グループ DM (3 人以上の DM)。
  slack-chan の `dm` サブコマンドは MVP では 1:1 DM 想定なので保守的に除外。
- `admin.*` 系 — slack-chan は admin 操作を行わない。
- `app_mentions:read` — webhook を持たないため通知を受けない。
- `commands` — slash command を提供しない。
- `incoming-webhook` — Bot Token 経由の `chat.postMessage` で代替。
- `pins:*` / `bookmarks:*` / `reminders:*` — MVP スコープ外。
- `team:read` — 必要になれば追加 (現状 `users:read` で代替可能)。
- `chat:write.customize` — アバター / username 上書きは MVP 外。

## 利用可能なトークンと拒否されるトークン (重要)

slack-chan は **境界で token のプレフィックスを検査** し、許可されないものは
そこで TypeError を投げて止めます。

| Prefix | 種別 | 受理 / 拒否 | 理由 |
|---|---|---|---|
| `xoxp-` | User OAuth | ✅ 受理 | 公式の OAuth フロー経由で発行される |
| `xoxb-` | Bot | ✅ 受理 | 同上 |
| `xoxc-` | ブラウザ session (cookie) | ❌ **拒否** | 公式 OAuth ではなくブラウザから抽出する経路。Slack AUP 違反、アカウント suspension リスク |
| `xoxd-` | ブラウザ session (`d` cookie) | ❌ **拒否** | 同上 |

実装は [`src/secrets/guard.ts`](../src/secrets/guard.ts) にあり、
[`tests/secrets/guard.test.ts`](../tests/secrets/guard.test.ts) で挙動を固定して
います。詳しい背景は README の [`Slack ToS / Acceptable Use Policy`](../README.md#slack-tos--acceptable-use-policy)
セクションと [`docs/seed.md` §6.1](./seed.md#61-slack-側) を参照してください。

## トラブルシューティング

### manifest UI で "invalid scope" / "unknown scope" になる

- Slack 側のスペルチェックに失敗している可能性があります。
  [`examples/slack-app-manifest.yml`](../examples/slack-app-manifest.yml) を直接
  コピペし、編集していないことを確認してください。
- それでも特定の scope だけ拒否される場合は、その行を一旦削除して App を作成し、
  作成後に **OAuth & Permissions** 画面から手動で追加すると通ることがあります。

### "This app needs to be approved by an admin" と表示されて Install できない

- ワークスペースが App 承認制になっています。`https://<your-workspace>.slack.com/apps/manage`
  でリクエスト状態を確認し、必要なら管理者に承認依頼を投げてください。
- 承認制の有無は **前提** セクション (本書 上部) のリンクからも確認できます。

### `xoxc-` / `xoxd-` を入れたら slack-chan に拒否された

- それは想定通りの挙動です。[§ 利用可能なトークンと拒否されるトークン](#利用可能なトークンと拒否されるトークン-重要)
  を参照してください。OAuth 経由で `xoxp-` / `xoxb-` を再取得してください。

### `users:read.email` で email が取れない

- ワークスペースの管理設定で email 共有が無効化されている可能性があります。
  この場合 scope を要求しても API レベルで `missing_scope` 相当が返ります。
  管理者に確認するか、email を必要としない動線で運用してください。

## 次のステップ

- **Phase 2 リリース後**: `slack-chan config workspace add --token=...` で
  実際にトークンを登録できるようになります。本書もそのタイミングで更新します。
- **Phase 4 リリース後**: Claude Code から SKILL.md 経由で `slack-chan` を
  呼び出せるようになります (plugin marketplace 登録 + Homebrew tap 整備)。
- 全体の設計判断 (なぜ自作なのか / SQLite を選んだ理由 / xoxc/xoxd 拒否方針 など)
  は [`docs/seed.md`](./seed.md) を読むと一気に把握できます。
