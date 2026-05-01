#!/usr/bin/env bash
# scripts/check-homebrew-template.sh
#
# homebrew/slack-chan.rb.tmpl を fixture 値で envsubst 展開し、Ruby の構文
# チェック (`ruby -c`) に通す。bump-homebrew.yml が CI で叩く検証パスを
# ローカル 1 コマンドで再現するためのスクリプト。
#
# 使い方:
#   bash scripts/check-homebrew-template.sh
#
# 終了コード:
#   0 — Syntax OK
#   非 0 — envsubst / ruby 不在 or テンプレが parse error
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
TMPL="${ROOT_DIR}/homebrew/slack-chan.rb.tmpl"
OUT="$(mktemp -t slack-chan-formula.XXXXXX.rb)"
trap 'rm -f "$OUT"' EXIT

if [[ ! -f "$TMPL" ]]; then
  echo "::error::template not found: $TMPL" >&2
  exit 1
fi

for cmd in envsubst ruby; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    echo "::error::required command not found: $cmd" >&2
    exit 1
  fi
done

# fixture 値: bump-homebrew.yml の fixture モードと揃える
export VERSION="0.0.0-fixture"
export SHA256_DARWIN_ARM64="$(printf 'a%.0s' {1..64})"
export SHA256_DARWIN_X64="$(printf 'b%.0s' {1..64})"
export SHA256_LINUX_ARM64="$(printf 'c%.0s' {1..64})"
export SHA256_LINUX_X64="$(printf 'd%.0s' {1..64})"

envsubst '${VERSION} ${SHA256_DARWIN_ARM64} ${SHA256_DARWIN_X64} ${SHA256_LINUX_ARM64} ${SHA256_LINUX_X64}' \
  < "$TMPL" \
  > "$OUT"

if ! ruby -c "$OUT" >/dev/null; then
  echo "::error::ruby parse error in rendered Formula" >&2
  echo "----- rendered Formula -----" >&2
  cat "$OUT" >&2
  echo "----------------------------" >&2
  exit 1
fi

echo "OK: ${TMPL} → rendered Formula は ruby -c に通りました (VERSION=${VERSION})"
