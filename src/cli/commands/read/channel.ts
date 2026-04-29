import type { Database } from "bun:sqlite";
import type { SlackClient } from "../../../slack/client.ts";
import * as channelsDao from "../../../storage/dao/channels.ts";
import { TransientError, UserError } from "../../errors.ts";

const CHANNEL_ID_RE = /^[CGDM][A-Z0-9]{1,32}$/;

interface ApiChannel {
  id?: string;
  name?: string;
  name_normalized?: string;
  is_private?: boolean;
}

interface ConversationsListResponse {
  ok?: boolean;
  channels?: ApiChannel[];
  error?: string;
}

const USER_ERROR_SLACK_ERRORS: ReadonlySet<string> = new Set([
  "channel_not_found",
  "not_in_channel",
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "missing_scope",
  "no_permission",
]);

export interface ResolvedChannel {
  channel_id: string;
  channel_name: string | null;
}

export interface ResolveChannelOptions {
  team_id: string;
  input: string;
  client: SlackClient;
  db: Database;
  now(): number;
}

function stripHash(s: string): string {
  return s.startsWith("#") ? s.slice(1) : s;
}

function looksLikeChannelId(s: string): boolean {
  return CHANNEL_ID_RE.test(s);
}

function inferChannelType(c: ApiChannel): string | null {
  if (c.is_private === true) return "private_channel";
  if (c.is_private === false) return "public_channel";
  return null;
}

export async function resolveChannelId(opts: ResolveChannelOptions): Promise<ResolvedChannel> {
  const { team_id, input, client, db, now } = opts;
  const raw = stripHash(input);

  // 1. id 形式: API call なしで channel row を最低限保証する。
  if (looksLikeChannelId(raw)) {
    const existing = channelsDao.getOne(db, team_id, raw);
    if (existing === null) {
      channelsDao.upsert(db, {
        team_id,
        channel_id: raw,
        name: null,
        type: null,
        topic: null,
        purpose: null,
        is_member: null,
        last_synced_ts: null,
        fetched_at: now(),
      });
    }
    return { channel_id: raw, channel_name: existing?.name ?? null };
  }

  // 2. cache lookup（M3: fetched_at DESC で決定的に最新行）
  const cached = channelsDao.getByName(db, team_id, raw);
  if (cached !== null) {
    return { channel_id: cached.channel_id, channel_name: cached.name };
  }

  // 3. API: conversations.list (public + private のみ。DM は本タスク対象外 / §8.3)
  let res: ConversationsListResponse;
  try {
    res = (await client.conversationsList({
      types: "public_channel,private_channel",
      limit: 1000,
    })) as ConversationsListResponse;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TransientError(`read: conversations.list failed: ${msg}`);
  }
  if (res.ok !== true) {
    const slackErr = res.error ?? "unknown";
    if (USER_ERROR_SLACK_ERRORS.has(slackErr)) {
      throw new UserError(`read: conversations.list returned ${slackErr}.`);
    }
    throw new TransientError(`read: conversations.list returned not-ok (${slackErr}).`);
  }

  const match = (res.channels ?? []).find((c) => c.name === raw || c.name_normalized === raw);
  if (match === undefined || typeof match.id !== "string" || match.id.length === 0) {
    throw new UserError(
      `read: channel '${raw}' not found in ${team_id}. Try the channel ID (Cxxxx), or run 'slack-chan config channel set-default' first.`,
    );
  }

  const resolvedName = typeof match.name === "string" && match.name.length > 0 ? match.name : raw;
  channelsDao.upsert(db, {
    team_id,
    channel_id: match.id,
    name: resolvedName,
    type: inferChannelType(match),
    topic: null,
    purpose: null,
    is_member: null,
    last_synced_ts: null,
    fetched_at: now(),
  });
  return { channel_id: match.id, channel_name: resolvedName };
}
