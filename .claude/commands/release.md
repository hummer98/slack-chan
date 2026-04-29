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
