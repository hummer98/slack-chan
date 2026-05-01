import { ErrorCode } from "@slack/web-api";
import type { SlackClient } from "../../../slack/client.ts";
import { UserError } from "../../errors.ts";
import type { UserKind } from "./argv.ts";
import { classifyDmSlackError } from "./errors.ts";

const MAX_USERS_LIST_PAGES = 20;
const USERS_LIST_LIMIT = 200;

interface MinimalUser {
  id?: string;
  name?: string;
  deleted?: boolean;
  profile?: {
    display_name?: string;
    display_name_normalized?: string;
  };
}

function isBotToken(token: string): boolean {
  return token.startsWith("xoxb-");
}

/**
 * `<user>` 引数を user_id (Uxxx / Wxxx) に解決する。
 *
 *   - kind="id":     文字列をそのまま返す。API は呼ばない。
 *   - kind="email":  `users.lookupByEmail` を 1 回呼ぶ。
 *   - kind="name":   `users.list` を `limit=200` で paginate し、
 *                    `name` / `profile.display_name` /
 *                    `profile.display_name_normalized` を case-insensitive で照合。
 *
 * 0 件 / 2 件以上の `@name` マッチは `UserError` を投げる。プロフィールキャッシュは
 * 持たない（T015 で集約予定）。bot token で `users:read.email` 不足の場合は
 * スコープ追加ヒントを付加する。
 */
export async function resolveUserId(opts: {
  user: string;
  userKind: UserKind;
  token: string;
  client: SlackClient;
}): Promise<string> {
  const { user, userKind, token, client } = opts;

  if (userKind === "id") return user;

  if (userKind === "email") {
    return resolveByEmail(user, token, client);
  }

  return resolveByName(user, client);
}

async function resolveByEmail(email: string, token: string, client: SlackClient): Promise<string> {
  let res: { ok?: boolean; user?: { id?: string }; error?: string };
  try {
    res = (await client.usersLookupByEmail({ email })) as {
      ok?: boolean;
      user?: { id?: string };
      error?: string;
    };
  } catch (e) {
    throw decorateLookupByEmailError(e, token);
  }
  if (res.ok !== true || typeof res.user?.id !== "string") {
    if (res.error === "users_not_found" || res.error === "email_not_found") {
      throw new UserError(`dm: no user found for email '${email}'.`);
    }
    if (res.error === "missing_scope") {
      throw missingScopeForEmail(token);
    }
    throw new UserError(`dm: users.lookupByEmail failed: ${res.error ?? "unknown"}`);
  }
  return res.user.id;
}

function decorateLookupByEmailError(e: unknown, token: string): unknown {
  if (e instanceof Error && (e as { code?: string }).code === ErrorCode.PlatformError) {
    const apiError = (e as { data?: { error?: unknown } }).data?.error;
    if (apiError === "missing_scope") {
      return missingScopeForEmail(token);
    }
  }
  return classifyDmSlackError(e);
}

function missingScopeForEmail(token: string): UserError {
  if (isBotToken(token)) {
    return new UserError(
      "dm: missing_scope — `users:read.email` is required to look up a user by email. " +
        "Add it to your Slack app's Bot Token Scopes, or use a user token (xoxp-) instead.",
    );
  }
  return new UserError(
    "dm: missing_scope — the token lacks `users:read.email` scope required for users.lookupByEmail.",
  );
}

async function resolveByName(arg: string, client: SlackClient): Promise<string> {
  const target = arg.startsWith("@") ? arg.slice(1) : arg;
  const targetLower = target.toLowerCase();

  const matches: string[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_USERS_LIST_PAGES; page++) {
    let res: {
      ok?: boolean;
      members?: MinimalUser[];
      response_metadata?: { next_cursor?: string };
      error?: string;
    };
    try {
      res = (await client.usersList({
        limit: USERS_LIST_LIMIT,
        ...(cursor !== undefined && cursor.length > 0 ? { cursor } : {}),
      })) as {
        ok?: boolean;
        members?: MinimalUser[];
        response_metadata?: { next_cursor?: string };
        error?: string;
      };
    } catch (e) {
      throw classifyDmSlackError(e);
    }
    if (res.ok === false) {
      if (res.error === "missing_scope") {
        throw new UserError(
          "dm: missing_scope — `users:read` is required to list users for @name resolution.",
        );
      }
      throw new UserError(`dm: users.list failed: ${res.error ?? "unknown"}`);
    }
    const members = Array.isArray(res.members) ? res.members : [];
    for (const m of members) {
      if (typeof m.id !== "string") continue;
      if (m.deleted === true) continue;
      const nameLower = typeof m.name === "string" ? m.name.toLowerCase() : "";
      const dispLower =
        typeof m.profile?.display_name === "string" ? m.profile.display_name.toLowerCase() : "";
      const dispNormLower =
        typeof m.profile?.display_name_normalized === "string"
          ? m.profile.display_name_normalized.toLowerCase()
          : "";
      if (nameLower === targetLower || dispLower === targetLower || dispNormLower === targetLower) {
        if (!matches.includes(m.id)) matches.push(m.id);
      }
    }
    const next = res.response_metadata?.next_cursor;
    if (typeof next !== "string" || next.length === 0) break;
    cursor = next;
  }

  if (matches.length === 0) {
    throw new UserError(`dm: no user matches @${target}. Pass a Uxxx id directly.`);
  }
  if (matches.length > 1) {
    throw new UserError(
      `dm: @${target} is ambiguous; matches ${matches.join(", ")}. Pass a Uxxx id directly.`,
    );
  }
  return matches[0] as string;
}
