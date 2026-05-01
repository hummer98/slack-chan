import { ErrorCode } from "@slack/web-api";
import type { UserRow } from "../../../storage/types.ts";
import { CliError, InternalError, TransientError, UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { parseUserArgv, type UserArgs } from "./argv.ts";
import type { Effects } from "./effects.ts";
import { renderUser, type UserResult } from "./output.ts";
import { newResolveUserSentinel, resolveUser } from "./resolveUser.ts";
import { loadToken, resolveWorkspace } from "./workspace.ts";

const USER_API_ERRORS: ReadonlySet<string> = new Set([
  "user_not_found",
  "users_not_found",
  "invalid_email",
  "invalid_arguments",
  "not_authed",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "missing_scope",
  "users_list_disabled",
  "fatal_error",
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
 * Convert any error thrown from a Slack SDK call into one of the three
 * `CliError` subclasses (UserError / TransientError / InternalError) using
 * the SDK's structured error fields.
 *
 * Note: this is a near-copy of post.classifySlackError / download.classifySlackError —
 * 共通化は別タスク (将来の負債整理) で扱う方針 (plan §6.1)。
 */
export function classifySlackError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (!(e instanceof Error)) return new InternalError(`user: ${String(e)}`);

  const code = (e as { code?: string }).code;

  if (code === ErrorCode.RateLimitedError) {
    const retry = (e as { retryAfter?: number }).retryAfter;
    return new TransientError(
      `user: rate limited (retry-after=${typeof retry === "number" ? retry : "?"}s)`,
    );
  }
  if (code === ErrorCode.PlatformError) {
    const apiError = (e as { data?: { error?: unknown } }).data?.error;
    if (typeof apiError === "string") {
      if (USER_API_ERRORS.has(apiError)) return new UserError(`user: ${apiError}`);
      if (TRANSIENT_API_ERRORS.has(apiError)) return new TransientError(`user: ${apiError}`);
      return new InternalError(`user: ${apiError}`);
    }
    return new InternalError(`user: ${e.message}`);
  }
  if (code === ErrorCode.HTTPError) {
    const status = (e as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 500 && status < 600) {
      return new TransientError(`user: HTTP ${status}`);
    }
    if (typeof status === "number" && status === 429) {
      return new TransientError("user: HTTP 429 (rate limited)");
    }
    return new InternalError(`user: HTTP ${status ?? "?"}: ${e.message}`);
  }
  if (code === ErrorCode.RequestError) {
    const original = (e as { original?: { code?: string; message?: string } }).original;
    const ncode = original?.code;
    if (typeof ncode === "string" && TRANSIENT_NETWORK_CODES.has(ncode)) {
      return new TransientError(`user: network ${ncode}`);
    }
    return new InternalError(`user: request error: ${original?.message ?? e.message}`);
  }
  return new InternalError(`user: ${e.message}`);
}

/**
 * Main `user` handler. flow:
 *   argv → resolveWorkspace → loadConfig → loadToken → createSlackClient →
 *   openDb → resolveUser (sentinel new) → format & write.
 */
export async function handleUser(ctx: CommandContext, effects: Effects): Promise<number> {
  const args: UserArgs = parseUserArgv(ctx.rest);

  const team_id = await resolveWorkspace(ctx, effects);

  const cfg = await effects.loadConfig();
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `user: workspace ${team_id} is not registered. Run \`slack-chan config workspace add --token=...\`.`,
    );
  }
  const token = await loadToken(team_id, ws.tokens_store, effects);

  const slackClient = effects.createSlackClient(team_id, token);
  const db = effects.openDb();
  const now = effects.now();
  const sentinel = newResolveUserSentinel();

  let row: UserRow;
  try {
    row = await resolveUser({
      db,
      client: slackClient,
      team_id,
      identifier: args.identifier,
      now,
      sentinel,
    });
  } catch (e) {
    throw classifySlackError(e);
  }

  let profile: unknown = null;
  if (row.profile_json !== null) {
    try {
      profile = JSON.parse(row.profile_json);
    } catch {
      profile = null;
    }
  }

  const result: UserResult = {
    ok: true,
    user: {
      team_id: row.team_id,
      user_id: row.user_id,
      name: row.name,
      real_name: row.real_name,
      email: row.email,
      profile,
      fetched_at: row.fetched_at,
    },
  };

  process.stdout.write(renderUser(result, ctx.format));
  return EXIT_OK;
}
