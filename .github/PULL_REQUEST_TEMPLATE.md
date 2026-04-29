<!--
Thank you for sending a PR. Please fill in every section. If a section does not
apply, write "n/a" rather than deleting it.
-->

## Summary

<!-- One or two sentences explaining the change and the motivation. -->

## Related issue

<!-- e.g. Closes #123, Refs #45. Use "n/a" if there is none. -->

## Type of change

- [ ] feat — new functionality
- [ ] fix — bug fix
- [ ] chore — tooling, deps, repo housekeeping
- [ ] docs — documentation only
- [ ] refactor — code change without behavior change
- [ ] test — tests only
- [ ] build — build system / packaging
- [ ] ci — CI configuration
- [ ] perf — performance work
- [ ] **breaking change** (also tick the matching type above)

## Test plan

<!--
What did you do to convince yourself this PR is correct?
- Automated tests added / updated (path)
- Manual verification steps
- Output of `bun run typecheck`, `bun run lint`, `bun run test`
-->

## nock fixtures

<!-- Tick only if this PR adds or modifies recorded fixtures. Leave blank otherwise. -->

- [ ] This PR adds or modifies nock fixtures.
- [ ] All token strings (`xoxp-`, `xoxb-`, `xoxa-`, refresh tokens, OAuth codes), user/channel/workspace IDs, email addresses, message bodies, and `Authorization` / `Cookie` headers have been redacted.

## ADR

<!-- If this PR introduces or revises an architectural decision, list the ADR(s). -->

- ADR added / updated: <!-- e.g. docs/decisions/0005-output-formatter.md -->

## Checklist

- [ ] `bun run typecheck` passes locally.
- [ ] `bun run lint` passes locally.
- [ ] `bun run test` passes locally.
- [ ] PR title follows Conventional Commits (`<type>(<scope>): <subject>`).
- [ ] If this is a breaking change: README, SECURITY.md, and/or relevant ADR have been updated.
- [ ] No Slack tokens, message contents, real user/channel IDs, or other PII appear in the diff or fixtures.
- [ ] CONTRIBUTING.md was followed for commit messages and branch naming.
