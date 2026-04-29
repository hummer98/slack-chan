import { ErrorCode } from "@slack/web-api";
import { CliError, InternalError, TransientError, UserError } from "../../errors.ts";

const USER_API_ERRORS: ReadonlySet<string> = new Set([
  "users_not_found",
  "user_not_found",
  "user_disabled",
  "email_not_found",
  "cannot_dm_bot",
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "invalid_blocks",
  "invalid_blocks_format",
  "msg_too_long",
  "no_text",
  "invalid_arguments",
  "not_authed",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "missing_scope",
  "thread_not_found",
]);

const TRANSIENT_API_ERRORS: ReadonlySet<string> = new Set([
  "ratelimited",
  "rate_limited",
  "timeout",
  "service_unavailable",
]);

const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/**
 * `post/handler.ts#classifySlackError` と同等。共通化は T015 完了タイミングで
 * `cli/slack-errors.ts` に引き上げる予定 (plan §11)。
 */
export function classifyDmSlackError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (!(e instanceof Error)) return new InternalError(`dm: ${String(e)}`);

  const code = (e as { code?: string }).code;

  if (code === ErrorCode.RateLimitedError) {
    const retry = (e as { retryAfter?: number }).retryAfter;
    return new TransientError(
      `dm: rate limited (retry-after=${typeof retry === "number" ? retry : "?"}s)`,
    );
  }
  if (code === ErrorCode.PlatformError) {
    const apiError = (e as { data?: { error?: unknown } }).data?.error;
    if (typeof apiError === "string") {
      if (USER_API_ERRORS.has(apiError)) return new UserError(`dm: ${apiError}`);
      if (TRANSIENT_API_ERRORS.has(apiError)) return new TransientError(`dm: ${apiError}`);
      return new InternalError(`dm: ${apiError}`);
    }
    return new InternalError(`dm: ${e.message}`);
  }
  if (code === ErrorCode.HTTPError) {
    const status = (e as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 500 && status < 600) {
      return new TransientError(`dm: HTTP ${status}`);
    }
    if (typeof status === "number" && status === 429) {
      return new TransientError("dm: HTTP 429 (rate limited)");
    }
    return new InternalError(`dm: HTTP ${status ?? "?"}: ${e.message}`);
  }
  if (code === ErrorCode.RequestError) {
    const original = (e as { original?: { code?: string; message?: string } }).original;
    const ncode = original?.code;
    if (typeof ncode === "string" && TRANSIENT_NETWORK_CODES.has(ncode)) {
      return new TransientError(`dm: network ${ncode}`);
    }
    return new InternalError(`dm: request error: ${original?.message ?? e.message}`);
  }
  return new InternalError(`dm: ${e.message}`);
}
