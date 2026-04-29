import { ErrorCode } from "@slack/web-api";
import type { SlackClient } from "../../../slack/client.ts";
import { InternalError, UserError } from "../../errors.ts";
import { classifyDmSlackError } from "./errors.ts";

const IM_CHANNEL_RE = /^D[A-Z0-9]{1,32}$/;

/**
 * `conversations.open` を叩いて user_id に対する IM channel id (`Dxxx`) を返す。
 * `users` パラメータは Slack API 仕様上カンマ区切り文字列のため、配列ではなく
 * 単一 user_id を文字列で渡す。
 *
 *   - `cannot_dm_bot` / `user_not_found` 等 → UserError
 *   - `missing_scope (im:write)` → bot/user 共通でスコープヒント付き UserError
 *   - 5xx / ratelimited → TransientError (classifyDmSlackError 経由)
 *   - レスポンスに `Dxxx` 以外が来た場合 → InternalError
 */
export async function openImChannel(opts: {
  user_id: string;
  client: SlackClient;
}): Promise<string> {
  const { user_id, client } = opts;
  let res: {
    ok?: boolean;
    channel?: { id?: string };
    error?: string;
  };
  try {
    res = (await client.conversationsOpen({
      users: user_id,
      return_im: true,
    })) as { ok?: boolean; channel?: { id?: string }; error?: string };
  } catch (e) {
    throw decorateOpenError(e);
  }

  if (res.ok !== true) {
    throw mapOpenApiError(res.error);
  }
  const id = res.channel?.id;
  if (typeof id !== "string") {
    throw new InternalError("dm: conversations.open returned no channel.id");
  }
  if (!IM_CHANNEL_RE.test(id)) {
    throw new InternalError(`dm: conversations.open returned non-IM channel id '${id}'`);
  }
  return id;
}

function mapOpenApiError(error: string | undefined): Error {
  if (error === "missing_scope") {
    return new UserError(
      "dm: missing_scope — `im:write` (and `mpim:write` for groups) is required to open a DM. " +
        "Add the scope to your Slack app, or use a user token (xoxp-).",
    );
  }
  if (
    error === "user_not_found" ||
    error === "users_not_found" ||
    error === "user_disabled" ||
    error === "cannot_dm_bot"
  ) {
    return new UserError(`dm: ${error}`);
  }
  return new UserError(`dm: conversations.open failed: ${error ?? "unknown"}`);
}

function decorateOpenError(e: unknown): unknown {
  if (e instanceof Error && (e as { code?: string }).code === ErrorCode.PlatformError) {
    const apiError = (e as { data?: { error?: unknown } }).data?.error;
    if (typeof apiError === "string") {
      if (apiError === "missing_scope") {
        return new UserError(
          "dm: missing_scope — `im:write` (and `mpim:write` for groups) is required to open a DM. " +
            "Add the scope to your Slack app, or use a user token (xoxp-).",
        );
      }
      if (
        apiError === "user_not_found" ||
        apiError === "users_not_found" ||
        apiError === "user_disabled" ||
        apiError === "cannot_dm_bot"
      ) {
        return new UserError(`dm: ${apiError}`);
      }
    }
  }
  return classifyDmSlackError(e);
}
