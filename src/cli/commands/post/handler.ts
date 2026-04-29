import { basename } from "node:path";
import {
  type ChatPostMessageArguments,
  ErrorCode,
  type FilesUploadV2Arguments,
} from "@slack/web-api";
import { selectFormatter } from "../../../output/format.ts";
import type { SlackClient } from "../../../slack/client.ts";
import { CliError, InternalError, TransientError, UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { type PostArgs, parsePostArgv } from "./argv.ts";
import { loadBlocks } from "./blocks.ts";
import { resolveChannel } from "./channels.ts";
import type { Effects, FileStat } from "./effects.ts";
import type { PostResult } from "./output.ts";
import { loadToken, resolveWorkspace } from "./workspace.ts";

const USER_API_ERRORS: ReadonlySet<string> = new Set([
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
 * Convert any error thrown from a Slack SDK call into one of the three
 * `CliError` subclasses (UserError / TransientError / InternalError) using
 * the SDK's structured error fields. Falls through to InternalError so a
 * future Slack `error` value cannot accidentally surface as exit 0.
 */
export function classifySlackError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (!(e instanceof Error)) return new InternalError(`post: ${String(e)}`);

  const code = (e as { code?: string }).code;

  if (code === ErrorCode.RateLimitedError) {
    const retry = (e as { retryAfter?: number }).retryAfter;
    return new TransientError(
      `post: rate limited (retry-after=${typeof retry === "number" ? retry : "?"}s)`,
    );
  }
  if (code === ErrorCode.PlatformError) {
    const apiError = (e as { data?: { error?: unknown } }).data?.error;
    if (typeof apiError === "string") {
      if (USER_API_ERRORS.has(apiError)) return new UserError(`post: ${apiError}`);
      if (TRANSIENT_API_ERRORS.has(apiError)) return new TransientError(`post: ${apiError}`);
      return new InternalError(`post: ${apiError}`);
    }
    return new InternalError(`post: ${e.message}`);
  }
  if (code === ErrorCode.HTTPError) {
    const status = (e as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 500 && status < 600) {
      return new TransientError(`post: HTTP ${status}`);
    }
    if (typeof status === "number" && status === 429) {
      return new TransientError("post: HTTP 429 (rate limited)");
    }
    return new InternalError(`post: HTTP ${status ?? "?"}: ${e.message}`);
  }
  if (code === ErrorCode.RequestError) {
    const original = (e as { original?: { code?: string; message?: string } }).original;
    const ncode = original?.code;
    if (typeof ncode === "string" && TRANSIENT_NETWORK_CODES.has(ncode)) {
      return new TransientError(`post: network ${ncode}`);
    }
    return new InternalError(`post: request error: ${original?.message ?? e.message}`);
  }
  return new InternalError(`post: ${e.message}`);
}

interface PostMessageInputs {
  channel_id: string;
  text: string;
  thread?: string;
  blocks?: unknown[];
}

async function callChatPostMessage(
  client: SlackClient,
  inputs: PostMessageInputs,
): Promise<PostResult> {
  // ChatPostMessageArguments is a union (ChannelAndText | ChannelAndBlocks | ...).
  // Build the object with both `text` (always) and `blocks` (when present) and
  // cast to the union type — the runtime contract matches `ChannelAndBlocks`
  // when blocks is present, `ChannelAndText` otherwise.
  const base: Record<string, unknown> = {
    channel: inputs.channel_id,
    text: inputs.text,
  };
  if (inputs.blocks !== undefined) base.blocks = inputs.blocks;
  if (inputs.thread !== undefined) base.thread_ts = inputs.thread;
  const args = base as unknown as ChatPostMessageArguments;
  const res = (await client.chatPostMessage(args)) as {
    ok?: boolean;
    ts?: string;
    channel?: string;
    error?: string;
  };
  if (res.ok !== true || typeof res.ts !== "string" || typeof res.channel !== "string") {
    throw new InternalError(`post: chat.postMessage returned not-ok: ${res.error ?? "unknown"}`);
  }
  const result: PostResult = { ok: true, channel: res.channel, ts: res.ts };
  if (inputs.thread !== undefined) result.thread_ts = inputs.thread;
  return result;
}

interface FileUploadInputs {
  channel_id: string;
  text: string;
  file: string;
  thread?: string;
}

async function callFilesUploadV2(
  client: SlackClient,
  inputs: FileUploadInputs,
): Promise<PostResult> {
  const args: FilesUploadV2Arguments = {
    channel_id: inputs.channel_id,
    initial_comment: inputs.text,
    file: inputs.file,
    filename: basename(inputs.file),
    ...(inputs.thread !== undefined ? { thread_ts: inputs.thread } : {}),
  } as FilesUploadV2Arguments;
  const res = (await client.filesUploadV2(args)) as {
    ok?: boolean;
    files?: { id?: string; title?: string }[];
    error?: string;
  };
  if (res.ok !== true) {
    throw new InternalError(`post: files.uploadV2 returned not-ok: ${res.error ?? "unknown"}`);
  }
  const first = Array.isArray(res.files) ? res.files[0] : undefined;
  const result: PostResult = { ok: true, channel: inputs.channel_id };
  if (first !== undefined) {
    if (typeof first.id === "string") result.file_id = first.id;
    if (typeof first.title === "string") result.file_title = first.title;
  }
  if (inputs.thread !== undefined) result.thread_ts = inputs.thread;
  return result;
}

/**
 * Main `post` handler. Implements the flow defined in plan §5:
 * argv parse → workspace → token → channel → blocks/file pre-check →
 * Slack API dispatch → format & write.
 *
 * Throws `CliError` subclasses; the outer dispatcher converts them to the
 * appropriate exit code via `runWithUserErrorReturn` + `runCli` catch.
 */
export async function handlePost(ctx: CommandContext, effects: Effects): Promise<number> {
  const args: PostArgs = parsePostArgv(ctx.rest);

  const team_id = await resolveWorkspace(ctx, effects);

  const cfg = await effects.loadConfig();
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `post: workspace ${team_id} is not registered. Run \`slack-chan config workspace add --token=...\`.`,
    );
  }
  const token = await loadToken(team_id, ws.tokens_store, effects);

  const slackClient = effects.createSlackClient(team_id, token);

  const channel_id = await resolveChannel(args.channel, slackClient);

  const blocks = args.blocks !== undefined ? await loadBlocks(args.blocks, effects) : undefined;

  if (args.file !== undefined) {
    let stats: FileStat;
    try {
      stats = effects.statSync(args.file);
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      const detail = e instanceof Error ? e.message : String(e);
      if (code === "ENOENT") {
        throw new UserError(`post: --file '${args.file}' not found (${detail}).`);
      }
      throw new UserError(`post: --file '${args.file}' could not be stat'd (${detail}).`);
    }
    if (!stats.isFile()) {
      throw new UserError(`post: --file '${args.file}' is not a regular file.`);
    }
  }

  let result: PostResult;
  try {
    if (args.file !== undefined) {
      result = await callFilesUploadV2(slackClient, {
        channel_id,
        text: args.text,
        file: args.file,
        ...(args.thread !== undefined ? { thread: args.thread } : {}),
      });
    } else {
      result = await callChatPostMessage(slackClient, {
        channel_id,
        text: args.text,
        ...(blocks !== undefined ? { blocks } : {}),
        ...(args.thread !== undefined ? { thread: args.thread } : {}),
      });
    }
  } catch (e) {
    throw classifySlackError(e);
  }

  const formatter = selectFormatter(ctx.format);
  process.stdout.write(formatter.format(result));
  return EXIT_OK;
}
