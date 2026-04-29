import type { Database } from "bun:sqlite";
import type { Logger } from "../../../output/logger.ts";
import type { SlackClient } from "../../../slack/client.ts";
import * as messagesDao from "../../../storage/dao/messages.ts";
import { TransientError, UserError } from "../../errors.ts";
import { mapMessage } from "./cache.ts";

export interface SyncThreadOptions {
  team_id: string;
  channel_id: string;
  thread_ts: string;
  client: SlackClient;
  db: Database;
  now(): number;
  logger: Logger;
}

interface ApiMessage {
  ts?: string;
  thread_ts?: string;
  user?: string;
  bot_id?: string;
  type?: string;
  subtype?: string;
  text?: string;
  edited?: { ts?: string; user?: string };
}

interface RepliesResponse {
  ok?: boolean;
  messages?: ApiMessage[];
  response_metadata?: { next_cursor?: string };
  error?: string;
  has_more?: boolean;
}

const USER_ERROR_SLACK_ERRORS: ReadonlySet<string> = new Set([
  "channel_not_found",
  "thread_not_found",
  "not_in_channel",
  "is_archived",
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "missing_scope",
  "no_permission",
]);

const REPLIES_PAGE_LIMIT = 200;

function dispatchSlackError(method: string, slackErr: string): never {
  if (USER_ERROR_SLACK_ERRORS.has(slackErr)) {
    throw new UserError(`read: ${method} returned ${slackErr}.`);
  }
  throw new TransientError(`read: ${method} returned not-ok (${slackErr}).`);
}

export async function syncThreadReplies(opts: SyncThreadOptions): Promise<void> {
  const { team_id, channel_id, thread_ts, client, db, now, logger } = opts;

  let cursor: string | undefined;
  let upsertCount = 0;
  do {
    const params: Parameters<typeof client.conversationsReplies>[0] = {
      channel: channel_id,
      ts: thread_ts,
      limit: REPLIES_PAGE_LIMIT,
    };
    if (typeof cursor === "string" && cursor.length > 0) {
      params.cursor = cursor;
    }
    let res: RepliesResponse;
    try {
      res = (await client.conversationsReplies(params)) as RepliesResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TransientError(`read: conversations.replies failed: ${msg}`);
    }
    if (res.ok !== true) {
      dispatchSlackError("conversations.replies", res.error ?? "unknown");
    }
    const list = res.messages ?? [];
    for (const msg of list) {
      const ts = msg.ts;
      if (typeof ts !== "string" || ts.length === 0) continue;
      // 親 (`ts === thread_ts`) は thread_ts フィールドを持たないことがあるため、
      // cache に書く際は親自身も `thread_ts = parent_ts` として保存する。
      const normalized: ApiMessage = {
        ...msg,
        thread_ts: typeof msg.thread_ts === "string" ? msg.thread_ts : thread_ts,
      };
      const existing = messagesDao.get(db, team_id, channel_id, ts);
      messagesDao.upsert(db, mapMessage(team_id, channel_id, normalized, now()));
      if (existing !== null && existing.deleted === 1) {
        messagesDao.markAlive(db, team_id, channel_id, ts);
      }
      upsertCount++;
    }
    cursor = res.response_metadata?.next_cursor;
  } while (typeof cursor === "string" && cursor.length > 0);

  logger.debug(`read.thread: synced ${upsertCount} replies for ${thread_ts}`);
}
