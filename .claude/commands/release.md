---
allowed-tools: Bash
description: "リリースを実行する（CHANGELOG 昇格 → version bump → commit → tag → push）"
---

# /release

slack-chan のリリースを実行する。`scripts/release.sh` を呼ぶだけの薄ラッパ。
ロジックはすべて `scripts/release.sh` 側にあり、Claude 以外（zsh / bash 直叩き）
からも `bash scripts/release.sh X.Y.Z` で同じ動作を再現できる。

## 使い方

- `/release 0.1.0` — version 0.1.0 をリリース（main で clean tree が前提）
- `/release --dry-run 0.1.0` — dry-run（実体は何も書き換えず、各ステップを stdout に echo するのみ）
- `/release` — patch bump 候補を表示し、`--yes` を要求

## 前提

- `main` ブランチで `git status` が clean であること
- 同名 tag (`vX.Y.Z`) が未存在であること
- `bun run typecheck` / `bun run test` / `bun run lint` がローカルで通ること

## 実体

```bash
bash scripts/release.sh "$ARGUMENTS"
```

push 後は `.github/workflows/release.yml` が tag を受けて
**npm publish (OIDC Trusted Publishing)** と **GitHub Release（bun compile
バイナリ 4 種 + SHA256SUMS 添付）** を実行する。詳細は `README.md` の
「Releasing」セクションと `docs/decisions/0006-release-process.md` を参照。

## 配布構造（npm + native binary + Claude plugin）

`@hummer98/slack-chan` は **npm tarball に native binary を同梱しない**設計。
代わりに `npm i -g @hummer98/slack-chan` 後、`bin/postinstall.js` が以下を行う：

1. `process.platform` / `process.arch` で対象 (`bun-darwin-arm64` 等) を決定
2. `https://github.com/hummer98/slack-chan/releases/download/v${VERSION}/slack-chan-${VERSION}-${TARGET}` を fetch
3. 同じ Release の `SHA256SUMS` で検証
4. `bin/slack-chan-native` に保存 + `chmod +x` → `bin/slack-chan.js` (Node 薄ラッパ) が spawn
5. `claude plugin marketplace add hummer98/slack-chan` + `claude plugin install slack-chan@slack-chan-marketplace --scope user` を実行（`claude` が PATH にあれば）

これにより `npm i -g` 1発で **(a) `slack-chan` コマンド + (b) Claude Code skill 登録** が完了する。

リリース時に注意するのは：

- **tag を push してから npm publish が走るまでの間、GitHub Release は未公開**。
  `release.yml` 内では `npm publish` の **後**に `gh release create` が走るが、
  publish 後 / Release 公開前のタイミングで `npm i -g` した利用者は postinstall の
  binary DL に失敗する。`provenance` の関係で順序を入れ替えにくいので、
  Release 公開後に npm publish を遅らせる手も検討する余地あり。
  （現状は dry-run + 短時間で順次完了するので実害は小さい）
- **postinstall は best-effort**。失敗しても `npm install` は成功扱いにし、
  ユーザーに復旧手順 (`npm rebuild` / Homebrew / 手動 DL) を案内する。
- **ローカル開発では postinstall はスキップ**される
  （`node_modules` 配下でない / `version=0.0.0` の場合）。
  リリース後のローカル `bun install` でも、`node_modules` の有無で skip を判定する。
