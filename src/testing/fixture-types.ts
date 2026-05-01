/**
 * Slack API fixture format used by the record / redact / replay workflow.
 *
 * `SlackFixtureRaw` is the on-disk shape immediately after `record-fixtures.ts`
 * captures a real response — it still carries PII / tokens / real IDs.
 * `SlackFixture` (literal `redacted: true`) is the only shape accepted by
 * `replayFixture`; the type system blocks unredacted JSON from reaching tests.
 *
 * See `docs/decisions/0009-fixture-recording-strategy.md` for the rationale.
 */
export interface SlackFixture {
  method: string;
  params: Record<string, unknown> | null;
  status: number;
  data: Record<string, unknown>;
  recorded_at: string;
  redacted: true;
}

export interface SlackFixtureRaw extends Omit<SlackFixture, "redacted"> {
  redacted: false;
}
