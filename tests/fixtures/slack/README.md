# Slack fixtures

Recorded Slack Web API responses for `replayFixture()`
(`src/testing/fixture-replay.ts`). Full workflow:
[CONTRIBUTING.md](../../../CONTRIBUTING.md) and
[ADR-0009](../../../docs/decisions/0009-fixture-recording-strategy.md).

## Layout

```
tests/fixtures/slack/<method>/<scenario>.json
```

`<method>` is the Slack API method name as-is, dots included
(`auth.test`, `chat.postMessage`). `<scenario>` is kebab-case
(`ok`, `not-in-channel`). Each file is a `SlackFixture`;
`replayFixture()` refuses `redacted: false`. CI gate:
`bun run redact-fixtures -- --check`.

## Caveats

- **`text` keys are replaced wholesale** to `redacted-message-N`,
  regardless of value. Hand-edit if a test needs the original literal.
- **ID word boundary is ASCII-only.** `U123ABC456_extra` (underscore-
  joined) escapes `\b` and stays as-is. Slack's normal responses do
  not produce this; hand-edit if you find one.

Prefer `replayFixture()` for full record→redact→replay coverage; keep
inline `spyOn(WebClient.prototype, "apiCall")` for retry / rate-limit
tests and minimal sanity checks.
