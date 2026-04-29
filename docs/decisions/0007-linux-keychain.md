# ADR-0007: Linux Secret Service Deferred

- Status: Deferred
- Date: 2026-04-29
- Phase: 2 (token storage)

## Context

T006 / Phase 2 で xoxp / xoxb トークンの永続化層を実装するにあたり、対応
バックエンドの優先度を決める必要がある。`docs/seed.md` §3.3 / §6.2 では
複数 OS でのトークン保管を将来要件として挙げているが、Phase 2 のスコープと
時間配分の観点から各 OS の実装コスト・運用コストを再評価した。

各候補:

- **macOS Keychain** — `security` CLI（`/usr/bin/security`）が標準搭載で、
  GUI prompt を含む一通りの API を `execFile` で安全に呼べる。OSS の依存追加
  なしで実装可能。
- **Linux Secret Service (libsecret / `secret-tool`)** — D-Bus 経由の Secret
  Service API はディストリビューションごとに既定の providers
  （GNOME Keyring / KWallet / pass / keepassxc）が異なり、ヘッドレス環境
  （CI、SSH、コンテナ、WSL）では起動していないことが多い。`secret-tool`
  を要求すると配布形態（`bun build --compile` の単一バイナリ、ADR-0001）
  と相性が悪く、依存検出と fallback ロジックを Phase 2 内で正しく書く時間
  予算が確保できない。
- **0600 file fallback** — `$XDG_CONFIG_HOME/slack-chan/tokens.json` を
  `chmod 600` / parent dir `chmod 700` で運用する設計。実装が単純で全 POSIX
  プラットフォームで一貫した挙動を取れる。symlink 検出 / atomic write /
  JSON parse fail-closed まで含めて Phase 2 のスコープで完結する（plan §3.3
  / §3.4）。

## Decision

Phase 2 では以下 2 backend のみを実装する:

1. **macOS Keychain backend** (`KeychainTokenStore`) — `process.platform ===
   "darwin"` かつ `security` 検出時に `factory.ts` から選択可能。
2. **0600 file fallback** (`FileTokenStore`) — 全 POSIX プラットフォームで
   利用可能。Linux ユーザの暫定運用はこちらを案内する。

**Linux Secret Service (`secret-tool` / libsecret) backend は本 Phase では
実装しない**。将来需要が顕在化したら別タスクで再評価する。

`createTokenStore("keychain", ...)` を非 darwin で呼んだ場合は **silent
fallback ではなく明示 throw** する（`factory.ts`）。利用者に「設定は
keychain だが実は file backend が動いていた」状態を作らないため。

Windows backend（DPAPI 等）は本 ADR の対象外。Bun の Windows サポートが
alpha 段階という別事情があるため、必要になった時点で別 ADR
（`0008-windows-keychain.md` を想定）を起こす。

## Consequences

- **Linux ユーザの運用**: `--tokens-store=file` を使い、`$XDG_CONFIG_HOME/
  slack-chan/tokens.json` を `chmod 600` で管理する。`FileTokenStore` は
  起動時に file mode（`(mode & 0o077) !== 0` で reject）と symlink を検証
  し、不安全なら明示エラーで停止する。これによって libsecret 未対応の
  ヘッドレス Linux / WSL / コンテナでも一貫した挙動が得られる。
- **GUI Linux ユーザ向けに段階的移行は可能**: `factory.ts` に
  `kind: "secret-service"` を追加するシグネチャ拡張は将来後方互換に行える
  （現在の `TokenStoreKind = "keychain" | "file"` 型を緩める形）。実装側は
  別タスクで `node:dbus` 系ライブラリの依存追加可否、CI での mock 戦略、
  ヘッドレス時の自動 fallback 仕様を新規 ADR で議論する。
- **CI への影響**: 本 ADR により Linux ランナーでは file backend のテスト
  のみが実行される。Keychain backend テストは macOS ローカルのみ実走
  （ADR Plan §3.9 の M4: `process.env.CI === "true"` で skip）。CI macOS で
  hang する事故も併せて回避できる。
- **将来の reconcile 課題**: `index.json` と Keychain 本体の整合性ずれ
  （ステルス token、外部から `security delete-generic-password` された等）
  は本タスクでは受容し、将来 `slack-chan doctor` 的な reconcile コマンド
  で対処する（Plan §6 R4）。本 ADR の deferred 判断とは独立だが、Linux
  Secret Service backend を入れる際にも同じ reconcile 問題が発生するため
  併せて再検討する。

## 暫定運用ガイド (Linux)

```sh
mkdir -p "$XDG_CONFIG_HOME/slack-chan"          # or $HOME/.config/slack-chan
chmod 700 "$XDG_CONFIG_HOME/slack-chan"
slack-chan auth login --tokens-store=file       # T021 で実装予定
chmod 600 "$XDG_CONFIG_HOME/slack-chan/tokens.json"
```

`tokens.json` の mode が `(mode & 0o077) !== 0` を満たす状態で起動すると
`FileTokenStore` が拒否し、`chmod 600 <path>` の案内と共に終了する。
