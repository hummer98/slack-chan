/**
 * Reject Slack browser-session tokens (`xoxc-*`, `xoxd-*`) at the boundary.
 *
 * Tokens of these prefixes are extracted from the Slack web UI session and
 * using them via the Web API violates Slack's Acceptable Use Policy (AUP),
 * with risk of account suspension. See docs/seed.md §3.3 / §6.1.
 */
export function assertAllowedSlackToken(token: unknown): asserts token is string {
  if (typeof token !== "string") {
    throw new TypeError("Slack token must be a string. Slack AUP applies.");
  }
  if (token.length === 0) {
    throw new Error("Empty Slack token is not allowed. Slack AUP applies.");
  }
  if (token.startsWith("xoxc-") || token.startsWith("xoxd-")) {
    throw new Error(
      "Browser-session tokens (xoxc-/xoxd-) violate Slack AUP and are not supported. See docs/seed.md §3.3 / §6.1.",
    );
  }
}
