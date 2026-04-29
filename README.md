# slack-chan

Slack interface for Claude — multi-workspace, default channels, persistent
local cache. Designed to be invoked by Claude Code via a Bash skill so the
agent can read context from Slack and post reports back without manual
plumbing.

> **Status: Phase 1 scaffolding only.** This repository currently contains
> the runtime / language setup, the directory skeleton for Phase 2+, the
> Slack AUP guard, and a minimal CLI that supports `--version` / `--help`.
> No subcommand is implemented yet.

## Quick start

```sh
# Requires Bun 1.3.x (pinned via .tool-versions for asdf / mise).
bun --version            # → 1.3.x
bun install
bun run dev -- --version # → 0.0.0
bun run dev -- --help
bun run typecheck
bun run lint
bun run test
bun run build            # → dist/slack-chan (single binary, bun --compile)
./dist/slack-chan --version
```

## Roadmap

- **Phase 1 (current PR): scaffolding** — `package.json`, `tsconfig.json`,
  `biome.json`, `src/` skeleton, AUP guard, `TokenStore` interface stub,
  empty migration, `bun test` + nock-fallback sanity, 4 ADRs.
- **Phase 2: SQLite + auth + config + CLI subcommand router** — real
  migrations, Keychain / Secret Service / 0600 file token store, TOML
  config under XDG paths, `citty`-style subcommand routing.
- **Phase 3: Slack feature commands** — `read` / `post` / `dm` / `download`
  / `user` / `search` / `api` / `sync` / `stats`, with cache semantics
  (incremental fetch + recent-N refetch for edits/deletes, on-demand
  thread replies).
- **Phase 4: SKILL.md + recording helper + distribution** — Claude Code
  plugin marketplace entry, npm publish, Homebrew tap, `bun build --compile`
  release pipeline.

See [`docs/seed.md`](docs/seed.md) for the design seed and
[`docs/decisions/`](docs/decisions/) for ADR-0001..0004 (SQLite driver,
CLI tooling, test runner, lint / format).

## Slack ToS / Acceptable Use Policy

Only `xoxp-` (User OAuth) and `xoxb-` (Bot) tokens are accepted.
`xoxc-` and `xoxd-` browser-session tokens are **rejected at the boundary**
because using them via the Web API violates Slack's Acceptable Use Policy
(AUP), risking account suspension. The guard lives in
[`src/secrets/guard.ts`](src/secrets/guard.ts) and is exercised in
[`tests/secrets/guard.test.ts`](tests/secrets/guard.test.ts).

## Toolchain

- Runtime: Bun 1.3.x (see [`.tool-versions`](.tool-versions))
- Language: TypeScript 6 (strict)
- Lint / format: Biome 2 (`biome check`)
- Test runner: `bun test`
- HTTP mocking (Phase 1 sanity): `WebClient.apiCall` stub, with `nock`
  retained as a devDep for Phase 5 re-evaluation (see ADR-0003)
- Build: `bun build --compile --target=bun` → single binary at
  `dist/slack-chan`

## Implementation notes

- **Phase 1: pre-build path; will switch to dist/ in npm publish task.**
  `package.json`'s `main` / `bin` / `exports` currently point at
  `./src/cli/index.ts` (the Bun runtime can execute `.ts` directly). This
  is intentional for Phase 1 because the only supported distribution path
  is the `bun build --compile` single binary. The Phase 2+ npm publish
  task will switch these to a built `dist/` artifact (or to a shim that
  forwards to the compiled binary). See ADR-0002 Consequences.
- nock is currently unable to intercept Bun's `ClientRequest` (the
  `req.path` property is a readonly proxy in Bun 1.3.13), so the
  `tests/slack/auth.test.ts` sanity check stubs `WebClient.prototype.apiCall`
  directly. Phase 5 (recording helper) will revisit nock vs msw. See
  ADR-0003 Consequences.

## License

MIT — see [`LICENSE`](LICENSE).
