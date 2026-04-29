/**
 * Number of trailing characters preserved by `redactToken`.
 *
 * Slack tokens are at minimum ~24 chars (xoxp-/xoxb- prefix + segments). 4
 * tail chars (base62, ~62^4 ≈ 1.5M combinations) are sufficient identifier
 * for ops triage but too small to brute-force the full token from a log.
 */
export const REDACT_KEEP_TAIL = 4;

const ALLOWED_PREFIXES = ["xoxp-", "xoxb-"] as const;

/**
 * Mask the middle of a Slack token for safe logging / error messages.
 *
 * - `xoxp-...abcd` → `xoxp-***abcd` (preserves prefix and last
 *   `REDACT_KEEP_TAIL` chars)
 * - empty / non-string / unsupported prefix / too-short tokens → `***`
 *
 * Never throws — this is intentionally tolerant so a logging path can never
 * cause a secondary failure.
 */
export function redactToken(token: unknown): string {
  if (typeof token !== "string" || token.length === 0) {
    return "***";
  }
  for (const prefix of ALLOWED_PREFIXES) {
    if (token.startsWith(prefix) && token.length >= prefix.length + REDACT_KEEP_TAIL) {
      const tail = token.slice(token.length - REDACT_KEEP_TAIL);
      return `${prefix}***${tail}`;
    }
  }
  return "***";
}
