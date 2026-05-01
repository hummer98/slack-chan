# ADR-0010: Claude Code plugin の配布チャネル — 自リポジトリを single-plugin marketplace として公開

- Status: Accepted
- Date: 2026-04-30
- Phase: 5（配布層）

## Context

`docs/seed.md` §3.6（配布優先順位）と §7.6（配布パイプライン）で、Claude Code
plugin marketplace 経由の配布が最優先と決まっているが、具体的にどの
marketplace を使うかは未決だった:

- **A**: `anthropics/claude-plugins-official` の `external_plugins/` への
  掲載申請（`claude.ai/settings/plugins/submit` フォーム経由）
- **B**: 本リポジトリ自体を single-plugin marketplace として公開し、
  `/plugin marketplace add hummer98/slack-chan` でユーザに取り込んでもらう
- **C**: `hummer98/claude-plugins` を別途立て、複数 plugin の総合
  marketplace として運用

T019 で plugin manifest と SKILL.md を整備するタイミングで方針を確定する
必要がある。`plugin.json` の `repository` / `homepage` フィールドは
marketplace のどこに登録するかと無関係に確定するが、`name` 衝突リスクと
README に書く install 手順は install チャネルに依存する。

## Decision

**B を採用する**: 本リポジトリ（`hummer98/slack-chan`）の root 直下に
`.claude-plugin/plugin.json` と `.claude-plugin/marketplace.json` を共置し、
`marketplace.json#plugins[].source` を `"./"` で自分自身を指す single-plugin
marketplace として公開する。

marketplace name は `slack-chan-marketplace`、plugin name は `slack-chan`。
ユーザの install コマンドは:

    /plugin marketplace add hummer98/slack-chan
    /plugin install slack-chan@slack-chan-marketplace

ローカル開発／検証時は `claude --plugin-dir ./` でも読み込める（manifest
を読むだけで marketplace を介さない）。

**`plugin.json#version` は省略する**（`marketplace.json` の plugin entry も
同様）。本リポジトリは GitHub host された git-hosted marketplace
（`source: "./"`）の条件を満たすので、未指定時の commit SHA fallback が利く
（公式仕様: "Pushing new commits without bumping it has no effect" の裏返し
として、version 省略時は毎 commit で update が伝搬する）。これにより 0.x の
活発な開発期間中は `package.json#version` と `plugin.json#version` を二重に
bump する負債を持たずに済む。`/release X.Y.Z` で `0.1.0` を切るタイミングで
初めて `plugin.json#version` を導入し、`scripts/release.sh` の bump 対象に
追加する。

A（公式 marketplace への submission）は **0.1.0 タグ + npm publish 完了
以降の別タスク**として残す。本 ADR は将来 A を併用することを妨げない
（plugin.json はそのまま使える、marketplace.json も remain）。C は将来
plugin が増えた段階で再評価する（現状 1 plugin で multi-plugin marketplace
を立てるのは over-engineering）。

## Consequences

- **更新フロー**: `git push` → marketplace は git commit SHA をバージョンと
  して扱う。0.x 期間中は version 省略運用で release.sh の改修不要。`0.1.0`
  タグで初めて `plugin.json#version` を導入する際に release.sh の bump
  ロジック追加（`package.json#version` と並列で書き換え）が必要になる。
- **marketplace.json の hosting**: 同一リポジトリ内なので追加 hosting 不要。
  relative path `"./"` は GitHub host された marketplace でのみ resolve 可能
  （URL 直指定の marketplace では NG）。本 ADR の B 戦略は GitHub repo
  として公開済みである前提に成立する。README ではこのため
  `claude plugin marketplace add https://raw.githubusercontent.com/...`
  形式は案内しない。
- **公式 marketplace への将来 submit**: 提出時点で `plugin.json` がそのまま
  使える。submission 後は `external_plugins/slack-chan/` として登録され、
  ユーザは `/plugin install slack-chan@claude-plugins-official` でも install
  できる（重複登録は害ではない、両方の marketplace に存在しても Claude Code
  は別 plugin として扱う、という公式仕様の確認は将来 A を併用する際に実機
  検証する）。
- **install scope**: `--scope user`（default）でホームディレクトリの
  `~/.claude/settings.json` に登録される。プロジェクト共有が必要な
  ユースケースは `--scope project` を README に記載する。
- **README への影響**: 「Install as a Claude Code plugin」セクションを
  `## Setting up Slack` の直後（token 取得 → install → roadmap の流れ）に
  追加し、(1) `claude --plugin-dir ./` でのローカル検証、(2) `/plugin
  marketplace add ...` での通常 install の 2 パスを記載する。
- **xoxc / xoxd 拒否は配布チャネルとは独立**: AUP guard は
  `src/secrets/guard.ts` に内蔵済み（Phase 1）。marketplace 経由で
  配布されても guard は外れない。
- **Future work**: (1) `0.1.0` タグ後に `claude.ai/settings/plugins/submit`
  から official marketplace へ submission（A の併用）、(2) `0.1.0` 切替時に
  `scripts/release.sh` に `plugin.json#version` の bump ロジック追加、
  (3) CI で `claude plugin validate .` を走らせる（公式 CLI が GitHub
  Actions 上で動かせれば）。

参考リンク: ADR-0001（依存最小化方針）、ADR-0006（リリースプロセス、
version bump 範囲を将来 plugin.json に拡張）、`docs/seed.md` §3.6 / §4.4 /
§7.6、公式 docs https://code.claude.com/docs/en/plugins と
https://code.claude.com/docs/en/plugins-reference と
https://code.claude.com/docs/en/plugin-marketplaces。
