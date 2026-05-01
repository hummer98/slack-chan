import type { Database } from "bun:sqlite";
import type { SlackClient } from "../../../slack/client.ts";
import * as usersDao from "../../../storage/dao/users.ts";
import type { UserRow } from "../../../storage/types.ts";
import { UserError } from "../../errors.ts";

// id: post の channel_id 検証 (`/^[CGD][A-Z0-9]{1,32}$/`) と同方針で `{1,32}` の緩い下限を採る。
// Slack 側で `user_not_found` を返した場合も classifySlackError 経由で UserError 化される。
const USER_ID_RE = /^[UW][A-Z0-9]{1,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const NAME_RE = /^[a-z0-9._-]{1,80}$/i;

const PAGE_LIMIT = 200;
const MAX_PAGES = 200;

function hasDisallowedControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x09 || c === 0x0a) continue;
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export type IdentifierKind =
  | { kind: "id"; value: string }
  | { kind: "email"; value: string }
  | { kind: "name"; value: string };

/**
 * Classify the user identifier into id / email / @name.
 *
 * 境界ケース:
 *   - `u01abcdef` (lowercase prefix) は USER_ID_RE が大文字限定なので name 扱い。
 *     name 解決は LOWER 比較なので Slack 側にも該当しないと miss → UserError。
 *   - 空白のみ / 内部に空白 → 空文字 / NAME_RE 不一致 で UserError。
 *   - `@alice@example.com` は先頭 @ を strip した結果 NAME_RE に合わず UserError。
 *   - `Alice` (case-mixed name) は NAME_RE が `/i` で許可、Slack 側で lowercase 正規化される想定。
 */
export function classifyIdentifier(raw: string): IdentifierKind {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    throw new UserError("user: <identifier> must be a non-empty string.");
  }
  if (hasDisallowedControlChar(trimmed)) {
    throw new UserError("user: <identifier> must not contain control characters.");
  }

  if (USER_ID_RE.test(trimmed)) {
    return { kind: "id", value: trimmed };
  }

  if (!trimmed.startsWith("@") && trimmed.includes("@") && EMAIL_RE.test(trimmed)) {
    return { kind: "email", value: trimmed };
  }

  const name = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  if (!NAME_RE.test(name)) {
    throw new UserError(
      `user: <identifier> '${raw}' is not a valid user id (Uxxx/Wxxx), email, or @name.`,
    );
  }
  return { kind: "name", value: name };
}

interface SlackMember {
  id?: string;
  name?: string;
  real_name?: string;
  is_bot?: boolean;
  deleted?: boolean;
  profile?: {
    real_name?: string;
    email?: string;
    image_72?: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}

function memberToRow(team_id: string, m: SlackMember, now: number): UserRow {
  const real_name =
    typeof m.real_name === "string"
      ? m.real_name
      : typeof m.profile?.real_name === "string"
        ? m.profile.real_name
        : null;
  const email = typeof m.profile?.email === "string" ? m.profile.email : null;
  return {
    team_id,
    user_id: typeof m.id === "string" ? m.id : "",
    name: typeof m.name === "string" ? m.name : null,
    real_name,
    email,
    profile_json: JSON.stringify(m),
    fetched_at: now,
  };
}

/** users.list 全 fetch の reentrancy guard。
 *  CLI 1 回呼出しで 1 つ生成し、複数の resolveUser 呼出し間で共有する。 */
export interface ResolveUserSentinel {
  fullFetched: boolean;
}

export function newResolveUserSentinel(): ResolveUserSentinel {
  return { fullFetched: false };
}

export interface ResolveUserInput {
  db: Database;
  client: SlackClient;
  team_id: string;
  identifier: string;
  now: number;
  sentinel: ResolveUserSentinel;
}

interface FetchAllUsersArgs {
  db: Database;
  client: SlackClient;
  team_id: string;
  now: number;
}

async function fetchAllUsersAndUpsert(args: FetchAllUsersArgs): Promise<void> {
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params: { limit: number; cursor?: string } = { limit: PAGE_LIMIT };
    if (cursor !== undefined && cursor.length > 0) params.cursor = cursor;
    const res = (await args.client.usersList(params)) as {
      members?: SlackMember[];
      response_metadata?: { next_cursor?: string };
    };
    const members = Array.isArray(res.members) ? res.members : [];
    for (const m of members) {
      if (typeof m.id !== "string" || m.id.length === 0) continue;
      usersDao.upsert(args.db, memberToRow(args.team_id, m, args.now));
    }
    const next = res.response_metadata?.next_cursor;
    if (typeof next !== "string" || next.length === 0) return;
    cursor = next;
  }
  throw new UserError(
    `user: workspace has too many users to scan (>${PAGE_LIMIT * MAX_PAGES}); ` +
      "supply user ID (Uxxx) or email directly.",
  );
}

/**
 * Resolve a `<identifier>` (id / email / @name) to a `UserRow`.
 *
 *   - id: cache hit → そのまま返す / cache miss → `users.info` → upsert
 *   - email: cache hit → そのまま返す / cache miss → `users.lookupByEmail` → upsert
 *   - @name: cache hit → そのまま返す / cache miss + sentinel.fullFetched=false →
 *     `users.list` 全 fetch → upsert → 再 lookup
 *
 * cache hit 時は `upsert` を呼ばないため `fetched_at` は更新されない。
 * Slack API 例外はそのまま re-throw する (呼び出し元 `handleUser` が classify する)。
 */
export async function resolveUser(input: ResolveUserInput): Promise<UserRow> {
  const { db, client, team_id, identifier, now, sentinel } = input;
  const kind = classifyIdentifier(identifier);

  switch (kind.kind) {
    case "id": {
      const cached = usersDao.get(db, team_id, kind.value);
      if (cached !== null) return cached;
      const res = (await client.usersInfo({ user: kind.value })) as {
        user?: SlackMember;
        ok?: boolean;
        error?: string;
      };
      const member = res.user;
      if (member === undefined || typeof member.id !== "string") {
        throw new UserError("user: users.info returned no user");
      }
      const row = memberToRow(team_id, member, now);
      usersDao.upsert(db, row);
      return row;
    }
    case "email": {
      const cached = usersDao.findByEmail(db, team_id, kind.value);
      if (cached !== null) return cached;
      const res = (await client.usersLookupByEmail({ email: kind.value })) as {
        user?: SlackMember;
        ok?: boolean;
        error?: string;
      };
      const member = res.user;
      if (member === undefined || typeof member.id !== "string") {
        throw new UserError("user: users.lookupByEmail returned no user");
      }
      const row = memberToRow(team_id, member, now);
      usersDao.upsert(db, row);
      return row;
    }
    case "name": {
      const cached = usersDao.findByName(db, team_id, kind.value);
      if (cached !== null) return cached;
      if (sentinel.fullFetched) {
        throw new UserError(
          `user: name '@${kind.value}' not found in workspace ${team_id} ` +
            `(scanned ${usersDao.count(db, team_id)} users via users.list).`,
        );
      }
      await fetchAllUsersAndUpsert({ db, client, team_id, now });
      sentinel.fullFetched = true;
      const after = usersDao.findByName(db, team_id, kind.value);
      if (after !== null) return after;
      throw new UserError(
        `user: name '@${kind.value}' not found in workspace ${team_id} ` +
          `(scanned ${usersDao.count(db, team_id)} users via users.list).`,
      );
    }
  }
}
