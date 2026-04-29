#!/usr/bin/env bash
# scripts/release.sh — slack-chan release driver.
#
# Usage:
#   scripts/release.sh <X.Y.Z>            # real release
#   scripts/release.sh --dry-run <X.Y.Z>  # echo every mutating step, do nothing
#   scripts/release.sh                    # suggest patch bump, require --yes
#
# Steps (real run):
#   1. validate args + verify clean main branch + tag absence
#   2. run typecheck + test + lint
#   3. rewrite CHANGELOG.md: [Unreleased] -> [X.Y.Z] - YYYY-MM-DD
#      (and re-insert an empty [Unreleased] block above)
#   4. rewrite package.json#version -> X.Y.Z
#   5. bun install (lockfile bump)
#   6. git commit "chore: release vX.Y.Z"
#   7. git tag vX.Y.Z
#   8. git push origin <main> + git push origin vX.Y.Z
#
# In --dry-run mode all of the above are echoed instead of executed and
# nothing on disk or in git is touched. Set
# SLACK_CHAN_RELEASE_SKIP_GIT_CHECKS=1 to skip the git pre-flight checks
# (used only by tests/scripts/release-dry-run.test.ts).
set -euo pipefail

readonly REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
readonly CHANGELOG="${REPO_ROOT}/CHANGELOG.md"
readonly PACKAGE_JSON="${REPO_ROOT}/package.json"

usage() {
  cat <<'EOF'
Usage:
  scripts/release.sh <X.Y.Z>
  scripts/release.sh --dry-run <X.Y.Z>
  scripts/release.sh --yes <X.Y.Z>
EOF
}

die() {
  echo "error: $*" >&2
  exit 1
}

DRY_RUN=false
ASSUME_YES=false
VERSION=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dry-run) DRY_RUN=true; shift ;;
    --yes) ASSUME_YES=true; shift ;;
    -h|--help) usage; exit 0 ;;
    -*) die "unknown flag: $1" ;;
    *) VERSION="$1"; shift ;;
  esac
done

if [[ -z "$VERSION" ]]; then
  current=$(node -e "console.log(require('${PACKAGE_JSON}').version)" 2>/dev/null \
    || bun -e "console.log((await Bun.file('${PACKAGE_JSON}').json()).version)")
  IFS='.' read -r major minor patch <<<"$current"
  next="${major}.${minor}.$((patch + 1))"
  echo "no version supplied. current package.json version: ${current}"
  echo "suggested patch bump: ${next}"
  if ! $ASSUME_YES; then
    die "re-run with: scripts/release.sh --yes ${next}  (or pass an explicit X.Y.Z)"
  fi
  VERSION="$next"
fi

if ! [[ "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  die "invalid version: '$VERSION' (expected X.Y.Z, e.g. 0.1.0)"
fi

readonly TAG="v${VERSION}"
readonly TODAY="$(date -u +%Y-%m-%d)"

run_or_echo() {
  if $DRY_RUN; then
    printf '[dry-run] %s\n' "$*"
  else
    eval "$@"
  fi
}

preflight_git() {
  if [[ "${SLACK_CHAN_RELEASE_SKIP_GIT_CHECKS:-}" == "1" ]]; then
    if $DRY_RUN; then
      echo "[dry-run] (skipping git preflight checks: SLACK_CHAN_RELEASE_SKIP_GIT_CHECKS=1)"
    fi
    return
  fi

  local branch
  branch=$(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD)
  if [[ "$branch" != "main" ]]; then
    die "must be on main (current: ${branch})"
  fi

  if [[ -n "$(git -C "$REPO_ROOT" status --porcelain)" ]]; then
    die "working tree is not clean (commit or stash changes first)"
  fi

  if git -C "$REPO_ROOT" rev-parse "$TAG" >/dev/null 2>&1; then
    die "tag ${TAG} already exists"
  fi
}

preflight_quality() {
  if $DRY_RUN; then
    echo "[dry-run] would run: bun run typecheck"
    echo "[dry-run] would run: bun run test"
    echo "[dry-run] would run: bun run lint"
    return
  fi
  (cd "$REPO_ROOT" && bun run typecheck)
  (cd "$REPO_ROOT" && bun run test)
  (cd "$REPO_ROOT" && bun run lint)
}

# Rewrite CHANGELOG.md so that:
#   ## [Unreleased]
#   <body>
# becomes
#   ## [Unreleased]
#
#   ### Added
#   ### Changed
#   ### Fixed
#
#   ## [X.Y.Z] - YYYY-MM-DD
#   <body>
bump_changelog() {
  if $DRY_RUN; then
    echo "[dry-run] would bump CHANGELOG.md: [Unreleased] -> [${VERSION}] - ${TODAY}"
    return
  fi
  local tmp="${CHANGELOG}.tmp"
  awk -v v="$VERSION" -v d="$TODAY" '
    BEGIN { swapped = 0 }
    {
      if (!swapped && $0 ~ /^## \[Unreleased\]/) {
        print "## [Unreleased]"
        print ""
        print "### Added"
        print ""
        print "- (placeholder)"
        print ""
        print "### Changed"
        print ""
        print "- (placeholder)"
        print ""
        print "### Fixed"
        print ""
        print "- (placeholder)"
        print ""
        print "## [" v "] - " d
        swapped = 1
        next
      }
      print
    }
  ' "$CHANGELOG" > "$tmp"
  mv "$tmp" "$CHANGELOG"
}

bump_package_json() {
  if $DRY_RUN; then
    echo "[dry-run] would set package.json#version to ${VERSION}"
    return
  fi
  node -e "
    const fs = require('fs');
    const p = '${PACKAGE_JSON}';
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    j.version = '${VERSION}';
    fs.writeFileSync(p, JSON.stringify(j, null, 2) + '\n');
  "
}

bun_install() {
  if $DRY_RUN; then
    echo "[dry-run] would run: bun install (refresh lockfile)"
    return
  fi
  (cd "$REPO_ROOT" && bun install)
}

make_commit() {
  if $DRY_RUN; then
    echo "[dry-run] would commit: chore: release ${TAG}"
    return
  fi
  git -C "$REPO_ROOT" add CHANGELOG.md package.json bun.lock 2>/dev/null || \
    git -C "$REPO_ROOT" add CHANGELOG.md package.json
  git -C "$REPO_ROOT" commit -m "chore: release ${TAG}"
}

make_tag() {
  if $DRY_RUN; then
    echo "[dry-run] would tag ${TAG}"
    return
  fi
  git -C "$REPO_ROOT" tag "$TAG"
}

do_push() {
  if $DRY_RUN; then
    echo "[dry-run] would push origin main"
    echo "[dry-run] would push origin ${TAG}"
    return
  fi
  git -C "$REPO_ROOT" push origin main
  git -C "$REPO_ROOT" push origin "$TAG"
}

echo "==> slack-chan release: ${TAG} ($($DRY_RUN && echo dry-run || echo real))"
preflight_git
preflight_quality
bump_changelog
bump_package_json
bun_install
make_commit
make_tag
do_push
echo "==> done. ($($DRY_RUN && echo 'dry-run; nothing was changed' || echo "tag ${TAG} pushed; GitHub Actions release.yml will publish to npm and create the GitHub Release"))"
