# Contributing to slack-chan

Thank you for considering a contribution. This document describes how to set up the project, the conventions we follow, and how to send a Pull Request.

## Code of Conduct

This project adopts the [Contributor Covenant v2.1](./CODE_OF_CONDUCT.md). By participating, you agree to abide by its terms. Reports of unacceptable behavior go to the contact listed in `CODE_OF_CONDUCT.md`.

## Reporting bugs / requesting features / asking questions

- Bugs, feature requests, and questions: please use the [Issue templates](./.github/ISSUE_TEMPLATE/). Forms guide you through the information we need.
- **Security vulnerabilities are out of scope for public Issues.** Use the channels listed in [SECURITY.md](./SECURITY.md) (GitHub Private Vulnerability Reporting, or the secondary email).
- General "how do I…" questions are best asked in GitHub Discussions if available; otherwise use the *Question* Issue template.

## Development environment

slack-chan targets [Bun](https://bun.sh/) `1.3.x`. The exact version is pinned in `.tool-versions`; we recommend [`asdf`](https://asdf-vm.com/) or [`mise`](https://mise.jdx.dev/) to manage the toolchain.

```sh
# Install dependencies
bun install

# Type-check, lint, test (run all three locally before pushing)
bun run typecheck
bun run lint
bun run test

# Build a single-file binary (Phase 2+; produces dist/slack-chan)
bun run build
```

In Phase 1, only `bun run dev -- --version` and `bun run dev -- --help` exercise real code paths. See `README.md` for the current scope.

> **Note on `bun run test` vs `bun test`:** the `package.json` script is defined as `"test": "bun test"`, but in this repository we standardize on **`bun run test`** in all documentation (CONTRIBUTING.md, PR template, SECURITY.md, README) so it is consistent with `bun run typecheck` / `bun run lint` and works for contributors used to the `npm`-style invocation. Either form runs the same tests.

## Project structure

- `src/` — TypeScript source. CLI entry: `src/cli/index.ts`. Subdirectories follow domain boundaries (`secrets/`, `slack/`, `storage/`, `output/`, `config/`).
- `tests/` — Bun test files. Mirrors `src/` layout where practical.
- `docs/decisions/` — Architecture Decision Records (ADRs). See **ADR conventions** below.
- `docs/seed.md` — Long-form design seed. Treat as background, not as a spec.

## Branch naming

Use a Conventional Commits–style prefix followed by a short kebab-case slug (ASCII only):

- `feat/<short-slug>` — new functionality
- `fix/<short-slug>` — bug fix
- `chore/<short-slug>` — tooling, deps, repo housekeeping
- `docs/<short-slug>` — documentation only
- `refactor/<short-slug>` — code change without behavior change
- `test/<short-slug>` — tests only
- `perf/<short-slug>` — performance work
- `ci/<short-slug>` — CI / GitHub Actions

Examples: `feat/reactions-add`, `fix/post-thread-ts-fallback`, `chore/biome-2.5`.

## Commit messages

We **recommend** [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/), but Phase 1 does not enforce them with `commitlint`. Strictness will be revisited once external contribution volume grows.

Format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

- `<type>` (use **singular** forms going forward): `feat` / `fix` / `chore` / `docs` / `refactor` / `test` / `build` / `ci` / `perf` / `revert`.
- `<scope>` is optional but encouraged (e.g. `feat(slack): add reactions.add`).
- Breaking changes: add a `BREAKING CHANGE:` footer **and** prefix the subject with `!` (e.g. `feat(cli)!: rename --workspace flag`).

> **Existing history note:** the bootstrap commits use a few non-Conventional types (`structure:`, `init:`) and a plural `tests:`. **From the next commit onward, please use the singular `test:` and avoid `structure:` / `init:`.** Map the intent to the closest standard type instead (`structure` → `chore` or `refactor`, `init` → `chore`).

## Pull Request guidelines

1. Fill in **every section** of `.github/PULL_REQUEST_TEMPLATE.md`. Sections that don't apply should say "n/a", not be deleted.
2. **CI green is required.** CI is not yet wired up at the time of writing; until then, the equivalent gate is that `bun run typecheck`, `bun run lint`, and `bun run test` all pass locally. Note this in the PR's *Test plan* section.
3. **Reviews:** at least **one approval** is required, and the author should not merge their own PR. For solo-maintainer phases, self-merge is permitted but must be called out explicitly in the PR description (e.g. "self-merging — solo maintenance window").
4. **Squash merge** is the default. Keep history linear; the squashed commit message should follow Conventional Commits.
5. Keep PRs focused. If you find unrelated cleanups along the way, open a separate PR rather than bundling them.
6. **PR title** should follow Conventional Commits — it becomes the squashed commit subject.

## Testing

- Run `bun run test` locally. The runner is Bun's built-in test framework; see `docs/decisions/0003-test-runner.md` for the rationale.
- Tests live under `tests/`. Place a new test next to the unit it covers (`src/foo/bar.ts` → `tests/foo/bar.test.ts`).
- Phase 1 does not yet record HTTP fixtures. The current Slack-API tests stub `WebClient.prototype.apiCall` with `spyOn` (see ADR-0003 for why nock is incompatible with Bun today).

### Slack fixture recording workflow (Phase 5+)

We do **not** intercept HTTP at the network layer. As of bun 1.3.13, nock's
`InterceptedRequestRouter` cannot reassign `req.path` on Bun's `ClientRequest`
(see [ADR-0003](./docs/decisions/0003-test-runner.md) Consequences). Instead,
fixtures are recorded once via the real Slack API and replayed by stubbing
`WebClient.prototype.apiCall` in tests. The full rationale — including why
`msw` was also rejected for Phase 5 — lives in
[ADR-0009](./docs/decisions/0009-fixture-recording-strategy.md).

#### Recording a new fixture

1. Acquire a real Slack token for the workspace you want to record against —
   **use a sandbox / personal workspace, never a production one** (no
   machine-side guard exists; this is enforced by convention).
2. Run the recorder once:

   ```sh
   SLACK_CHAN_RECORD=1 bun run record-fixtures -- \
       --method auth.test --scenario ok --team-id T01ABCDEF
   ```

   Auth resolution order: `SLACK_CHAN_TEST_TOKEN` + `SLACK_CHAN_TEST_TEAM_ID`
   env vars (CI / sandbox), then TokenStore lookup by `--team-id`. The
   recorder writes `tests/fixtures/slack/<method>/<scenario>.json` as a
   `SlackFixtureRaw` (`redacted: false`).

3. Redact PII / tokens **before the file leaves your machine**:

   ```sh
   bun run redact-fixtures
   ```

4. Verify there are no leftover real values:

   ```sh
   bun run redact-fixtures -- --check    # exit 0 means clean
   ```

5. Commit the redacted JSON. The fixture is now `redacted: true` and accepted
   by `replayFixture()`.

#### Mandatory redaction targets

- Slack tokens (`xoxb-`, `xoxp-`, `xoxa-`, `xoxr-`, `xoxs-`, `xapp-`)
  — collapsed to `xoxb-test-token`.
- Real email addresses → `user-N@example.test`.
- User / Team / Channel / DM / Group / Enterprise / File IDs → `U_TEST_NNN`,
  `T_TEST_NNN`, etc. The N for User IDs and emails is shared per entity so
  `real_name` / `display_name` / `name` line up with the same person.
- Message text bodies and DM contents → `redacted-message-N`.
- File names, URLs, and attachment metadata are touched only via the rules
  above; `text` keys are replaced wholesale (see caveats below).
- `Authorization` / `Cookie` / `Set-Cookie` headers — the recorder does not
  persist headers, enforced by `src/testing/fixture-types.ts`.

#### Known caveats

- **`text` keys are replaced wholesale.** Any object key named exactly `text`
  is rewritten to `redacted-message-N` regardless of the original value, so
  short metadata strings (e.g. `block.type === "rich_text"` style markers)
  are also replaced. This is a deliberate "safe by default" choice —
  particularly for non-ASCII PII that regex-based redaction would miss. If a
  fixture genuinely needs the original literal in a `text` field, hand-edit
  the JSON after `bun run redact-fixtures` and document the override in the
  test that consumes it.
- **Slack ID word boundary (`\b`) is ASCII-only.** Forms like
  `U123ABC456_extra` (underscore-joined) are not redacted because `\b`
  does not split between two word characters. Slack's normal API responses
  do not produce this shape, so the gap is accepted for the MVP. If you
  encounter such a value, hand-edit the fixture before commit.

#### Replaying in tests

Use `replayFixture()` from `src/testing/fixture-replay.ts`. The helper
throws if the JSON is unredacted, so an accidentally-committed raw fixture
fails fast. See `tests/slack/auth.replay.test.ts` for a worked example.

The existing `WebClient.prototype.apiCall` `spyOn` pattern in
`tests/slack/auth.test.ts` and `tests/slack/client.test.ts` remains
supported — inline stubs are still the right choice for retry / rate-limit
tests that exercise the axios layer, and for one-off sanity checks.

## ADR conventions

Architectural decisions are recorded under `docs/decisions/NNNN-<short-slug>.md`:

- **Numbering:** zero-padded 4-digit sequence, monotonically increasing. Pick the next free number.
- **Slug:** kebab-case, lowercase ASCII.
- **Length:** 200–400 words is typical. Brevity is a feature.
- **Sections:** `Status`, `Date`, `Phase`, `Context`, `Decision`, `Consequences`.
- **Existing examples:** `0001-sqlite-driver.md`, `0002-cli-tooling.md`, `0003-test-runner.md`, `0004-lint-format.md`. Copy the structure of any of these.

Add a new ADR whenever you introduce a non-obvious architectural choice (a library swap, a new boundary, a hard constraint discovered the hard way). Reference the ADR from the relevant PR.

## Review philosophy

- We optimize for **clarity and a small surface area** over cleverness.
- Tests over speculation: if a behavior is worth merging, it is worth a test (at the appropriate level).
- ADRs over tribal knowledge: if a decision will surprise a future reader, write it down.
- Be kind. Code review is about the code, not the contributor.

Thanks again for contributing.
