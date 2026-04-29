import { afterEach, describe, expect, it, mock, spyOn } from "bun:test";
import { WebClient } from "@slack/web-api";

/**
 * WebClient.auth.test sanity check.
 *
 * Phase 1 fallback: as of bun 1.3.13 + nock 14.0.13, nock's
 * `InterceptedRequestRouter` cannot reassign `req.path` on Bun's
 * `ClientRequest` (the property is a readonly proxy), so HTTP-layer
 * interception via nock fails. See plan §6.2 (three-step fallback) and
 * ADR-0003 Consequences.
 *
 * To still exercise the WebClient code path against a stable surface, we
 * stub `WebClient.prototype.apiCall` directly. The Phase 5 recording-helper
 * task will revisit nock vs msw on whichever Bun / @slack/web-api versions
 * are current then.
 */
describe("Slack WebClient.auth.test (apiCall stub fallback)", () => {
  afterEach(() => {
    mock.restore();
  });

  it("returns the mocked auth payload via WebClient.apiCall stub", async () => {
    const expected = { ok: true, team: "T123", user: "U123" };
    const proto = WebClient.prototype as unknown as {
      apiCall: (...args: unknown[]) => Promise<unknown>;
    };
    spyOn(proto, "apiCall").mockResolvedValue(expected);

    const client = new WebClient("xoxb-test-token");
    const res = await client.auth.test();

    expect(res.ok).toBe(true);
    expect(res.team).toBe("T123");
    expect(res.user).toBe("U123");
  });
});
