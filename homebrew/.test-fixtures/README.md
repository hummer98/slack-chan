# Homebrew tap dry-run fixtures

`bump-homebrew.yml` の `workflow_dispatch` で `dry_run=true` かつ `tag` が
未指定 (`""`) のときに読み込まれる固定 fixture を置いている。

実際の release が無い段階でも `bump-homebrew.yml` の Formula 生成パス
（envsubst でテンプレ展開 → `homebrew-tap/Formula/slack-chan.rb` 生成 →
job log に diff 表示）までを通せるようにし、
**完了条件「dry-run で PR が作れることを確認」**を本番 release 前から検証
できるようにすることが目的。dry-run モードでは `peter-evans/create-pull-request`
step は `if:` で skip されるため PR は作成されない。

## 構成

| ファイル | 役割 |
| --- | --- |
| `SHA256SUMS` | release.yml が出力する 2 列フォーマット (`<sha>  <filename>`) と同じ形。バージョンは `0.0.0-fixture` に固定。sha は `a`/`b`/`c`/`d` をそれぞれ 64 文字並べたダミー値。 |

## 注意

- **dry-run 検証専用**。本番の `release: published` trigger や `workflow_dispatch`
  で `tag` を明示したときは `gh release download` から取得した実 SHA256SUMS が
  使われ、この fixture は参照されない。
- ダミー sha は固定値なので絶対に本番 Formula に流出させないこと
  （dry-run モードでは PR 作成 step が `if:` で skip されるため PR は作られない）。
- バージョン文字列を変えたいときは `SHA256SUMS` のファイル名部分と、
  `bump-homebrew.yml` 内の fixture VERSION 既定値の両方を揃えて変えること。
