import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { WebClient, WebClientEvent } from "@slack/web-api";
import { SlackClient } from "../../src/slack/client.ts";

/**
 * Phase 2 SlackClient wrapper tests.
 *
 * As of bun 1.3.13 + nock 14.0.13, nock cannot reassign req.path on Bun's
 * ClientRequest, so HTTP-layer interception fails. We fall back to stubbing
 * `WebClient.prototype.apiCall` directly (same pattern as tests/slack/auth.test.ts).
 */

const TEAM_ID = "T01ABCDEF";
const TOKEN = "xoxb-test-token";

describe("SlackClient happy path (apiCall stub)", () => {
  afterEach(() => {
    mock.restore();
  });

  it("authTest resolves with team and user from the mocked apiCall", async () => {
    const expected = { ok: true, team: TEAM_ID, user: "U01ABCDEF" };
    const proto = WebClient.prototype as unknown as {
      apiCall: (...args: unknown[]) => Promise<unknown>;
    };
    spyOn(proto, "apiCall").mockResolvedValue(expected);

    const client = new SlackClient({ team_id: TEAM_ID, token: TOKEN });
    const res = await client.authTest();

    expect(res.ok).toBe(true);
    expect(res.team).toBe(TEAM_ID);
    expect(res.user).toBe("U01ABCDEF");
  });
});

describe("SlackClient retry behavior (axios.post stub at instance layer)", () => {
  afterEach(() => {
    mock.restore();
  });

  /**
   * @slack/web-api v7 implements retry inside WebClient#apiCall via p-retry.
   * Stubbing WebClient.prototype.apiCall bypasses that retry path entirely
   * (the stub replaces the p-retry-wrapped task), so we mock the instance-level
   * `axios.post` instead — the outer `apiCall` runs untouched and p-retry sees
   * a real 429 → 200 sequence. The internal retry config is also speeded up so
   * the test does not wait the default 1s minTimeout.
   *
   * See plan §2.6.1 retry test design + design-review-rev2 Minor 1 fallback (3).
   */
  it("retries the underlying HTTP request on 429 and resolves with ok=true", async () => {
    const client = new SlackClient({
      team_id: TEAM_ID,
      token: TOKEN,
      options: { maxRetries: 3 },
    });
    const internal = (client as unknown as { client: WebClient }).client as unknown as {
      axios: { post: (...args: unknown[]) => Promise<unknown> };
      retryConfig: Record<string, unknown>;
    };

    internal.retryConfig = { retries: 3, factor: 2, minTimeout: 1, maxTimeout: 1 };

    const postSpy = spyOn(internal.axios, "post")
      .mockResolvedValueOnce({
        status: 429,
        statusText: "Too Many Requests",
        headers: { "retry-after": "0" },
        data: undefined,
        config: {},
        request: { path: "/api/auth.test" },
      })
      .mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        headers: {},
        data: { ok: true, team: TEAM_ID, user: "U01ABCDEF" },
        config: {},
        request: { path: "/api/auth.test" },
      });

    const result = await client.authTest();

    expect(postSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(postSpy.mock.calls.length).toBeLessThanOrEqual(4);
    expect(result.ok).toBe(true);
    expect(result.team).toBe(TEAM_ID);
  });
});

describe("SlackClient rate-limit indicator", () => {
  afterEach(() => {
    mock.restore();
  });

  it("emits a [slack-chan] warn line on WebClientEvent.RATE_LIMITED with url/team/retry_after", () => {
    const writeSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

    const client = new SlackClient({ team_id: TEAM_ID, token: TOKEN });
    const internal = (client as unknown as { client: WebClient }).client;

    const url = "https://slack.com/api/conversations.history";
    const rawToken = "xoxb-1234-5678-abcdefghij-secret";
    internal.emit(WebClientEvent.RATE_LIMITED, 12, {
      url,
      body: { token: rawToken },
    });

    const out = writeSpy.mock.calls.map((c) => String(c[0])).join("");
    expect(out).toContain("[slack-chan]");
    expect(out).toContain("warn");
    expect(out).toContain("retry_after=12");
    expect(out).toContain(`url=${url}`);
    expect(out).toContain(`team=${TEAM_ID}`);
    expect(out).not.toContain(rawToken);
  });
});
