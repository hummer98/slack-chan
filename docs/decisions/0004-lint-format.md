# ADR-0004: lint / format — `biome` を採用

- Status: Accepted
- Date: 2026-04-29
- Phase: 1 (scaffolding)

## Context

slack-chan は greenfield かつ 1 言語（TypeScript）の OSS。lint / format ツールは
`biome` v2 系、対抗は `eslint` + `prettier` の二刀流。React は使わず、独自の
ESLint カスタムルールも持たないため Biome の機能制限には抵触しない。

## Decision

`biome` v2 系を採用する。`@biomejs/biome` 1 つの devDep / `biome.json` 1 つの
設定ファイルで lint と format を兼ねる。

## Consequences

scaffolding コストを最小化できる。CI 再現性のため `bun run lint` は read-only
の `biome check` に紐づけ、自動修正は `bun run format`（`biome format --write`）
／ あるいは `bun run lint:fix`（`biome check --write`）に分離する（`scripts.lint`
に `--write` を含めない）。

`biome.json` の `files.includes` には Phase 1 から `src/**` と `tests/**` を含めて
あり、後続コミットで再修正する必要はない。設定は段階導入として `linter.rules.
recommended` のみで開始し、Phase 2 で `style/useImportType` 等の TS 厳格ルールの
追加を検討する。将来 React や独自 lint ルールが必要になった場合は ESLint との
併用を再度検討する。
