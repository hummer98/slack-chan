import { ErrorCode, type WebAPICallResult } from "@slack/web-api";
import { selectFormatter } from "../../../output/format.ts";
import { CliError, InternalError, TransientError, UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { type ApiArgs, parseApiArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";
import type { ApiResult } from "./output.ts";
import { type ApiParams, parseApiParams } from "./params.ts";
import { loadToken, resolveWorkspace } from "./workspace.ts";

const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

/**
 * Convert any error thrown from `SlackClient.apiCall` into a `CliError`
 * subclass. PlatformError (`ok:false`) is **not** expected to reach this
 * function — the handler intercepts it earlier and routes the response to
 * stdout (see plan §6.1). The PlatformError branch is kept for parity with
 * `post`'s classifier so a future regression cannot accidentally surface as
 * exit 0.
 */
export function classifySlackError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (!(e instanceof Error)) return new InternalError(`api: ${String(e)}`);

  const code = (e as { code?: string }).code;

  if (code === ErrorCode.RateLimitedError) {
    const retry = (e as { retryAfter?: number }).retryAfter;
    return new TransientError(
      `api: rate limited (retry-after=${typeof retry === "number" ? retry : "?"}s)`,
    );
  }
  if (code === ErrorCode.PlatformError) {
    return new InternalError(`api: ${e.message}`);
  }
  if (code === ErrorCode.HTTPError) {
    const status = (e as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 500 && status < 600) {
      return new TransientError(`api: HTTP ${status}`);
    }
    if (typeof status === "number" && status === 429) {
      return new TransientError("api: HTTP 429 (rate limited)");
    }
    return new InternalError(`api: HTTP ${status ?? "?"}: ${e.message}`);
  }
  if (code === ErrorCode.RequestError) {
    const original = (e as { original?: { code?: string; message?: string } }).original;
    const ncode = original?.code;
    if (typeof ncode === "string" && TRANSIENT_NETWORK_CODES.has(ncode)) {
      return new TransientError(`api: network ${ncode}`);
    }
    return new InternalError(`api: request error: ${original?.message ?? e.message}`);
  }
  return new InternalError(`api: ${e.message}`);
}

function isPlatformErrorWithData(
  e: unknown,
): e is Error & { code: string; data: WebAPICallResult } {
  if (!(e instanceof Error)) return false;
  const code = (e as { code?: string }).code;
  if (code !== ErrorCode.PlatformError) return false;
  const data = (e as { data?: unknown }).data;
  return typeof data === "object" && data !== null;
}

/**
 * Main `api` handler. Implements the flow defined in plan §3:
 *   parseApiArgv → parseApiParams → resolveWorkspace → loadConfig → loadToken
 *   → createSlackClient → apiCall → format & write.
 *
 * Unlike `post`, an `ok:false` Slack response is **not** an error here:
 * `WebClient.apiCall` throws a `PlatformError` whose `data` field is the raw
 * response, and this handler emits that response to stdout so users can pipe
 * to `jq '.error'`. Only transport-level failures (rate-limit / 5xx /
 * network) translate into a non-zero exit.
 */
export async function handleApi(ctx: CommandContext, effects: Effects): Promise<number> {
  const args: ApiArgs = parseApiArgv(ctx.rest);
  const params: ApiParams = parseApiParams(args.rawParams);

  const team_id = await resolveWorkspace(ctx, effects);

  const cfg = await effects.loadConfig();
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `api: workspace ${team_id} is not registered. Run \`slack-chan config workspace add --token=...\`.`,
    );
  }
  const token = await loadToken(team_id, ws.tokens_store, effects);

  const client = effects.createSlackClient(team_id, token);

  let result: ApiResult;
  try {
    result = await client.apiCall(args.method, params);
  } catch (e) {
    if (isPlatformErrorWithData(e)) {
      result = e.data;
    } else {
      throw classifySlackError(e);
    }
  }

  const formatter = selectFormatter(ctx.format);
  process.stdout.write(formatter.format(result));
  return EXIT_OK;
}
