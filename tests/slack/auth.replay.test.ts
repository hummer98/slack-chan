import { afterEach, describe, expect, it, mock } from "bun:test";
import { WebClient } from "@slack/web-api";
import { replayFixture } from "../../src/testing/fixture-replay.ts";

/**
 * Phase 5 fixture-replay smoke test.
 *
 * Loads the redacted `auth.test/ok.json` fixture and asserts that
 * `WebClient.auth.test()` returns the same payload via the apiCall stub
 * installed by `replayFixture`. Compare with `tests/slack/auth.test.ts` —
 * the latter writes an inline stub for the minimum sanity case; this one
 * exercises the full record → redact → replay pipeline end-to-end.
 *
 * See ADR-0009 and CONTRIBUTING.md "Slack fixture recording workflow".
 */
describe("Slack auth.test (fixture replay)", () => {
  afterEach(() => {
    mock.restore();
  });

  it("returns the redacted fixture payload via WebClient.auth.test()", async () => {
    const fixture = replayFixture("tests/fixtures/slack/auth.test/ok.json");

    const client = new WebClient("xoxb-test-token");
    const res = await client.auth.test();

    expect(res).toEqual(fixture.data as never);
    expect(fixture.redacted).toBe(true);
    expect(res.team_id).toBe("T_TEST_001");
    expect(res.user_id).toBe("U_TEST_001");
  });
});
