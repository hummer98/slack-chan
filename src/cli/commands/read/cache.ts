import type { Database } from "bun:sqlite";
import type { Logger } from "../../../output/logger.ts";
import type { SlackClient } from "../../../slack/client.ts";
import * as channelsDao from "../../../storage/dao/channels.ts";
import * as messagesDao from "../../../storage/dao/messages.ts";
import type { MessageUpsertInput } from "../../../storage/types.ts";
import { TransientError, UserError } from "../../errors.ts";

export type SyncMode = "incremental" | "full-edit-scan" | "refresh";

export interface SyncOptions {
  team_id: string;
  channel_id: string;
  mode: SyncMode;
  cache_window_days: number;
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

interface ConversationsHistoryResponse {
  ok?: boolean;
  messages?: ApiMessage[];
  response_metadata?: { next_cursor?: string };
  error?: string;
  has_more?: boolean;
}

const USER_ERROR_SLACK_ERRORS: ReadonlySet<string> = new Set([
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "invalid_auth",
  "token_revoked",
  "account_inactive",
  "missing_scope",
  "no_permission",
]);

const HISTORY_PAGE_LIMIT = 200;

function minStr(values: ReadonlyArray<string>): string {
  if (values.length === 0) {
    throw new Error("minStr: empty");
  }
  let r = values[0] as string;
  for (let i = 1; i < values.length; i++) {
    const v = values[i] as string;
    if (v < r) r = v;
  }
  return r;
}

function maxStr(values: ReadonlyArray<string>): string {
  if (values.length === 0) {
    throw new Error("maxStr: empty");
  }
  let r = values[0] as string;
  for (let i = 1; i < values.length; i++) {
    const v = values[i] as string;
    if (v > r) r = v;
  }
  return r;
}

function notNull<T>(v: T | null | undefined): v is T {
  return v !== null && v !== undefined;
}

export function mapMessage(
  team_id: string,
  channel_id: string,
  msg: ApiMessage,
  fetched_at: number,
): MessageUpsertInput {
  const ts = msg.ts ?? "";
  return {
    team_id,
    channel_id,
    ts,
    thread_ts: typeof msg.thread_ts === "string" ? msg.thread_ts : null,
    user_id: typeof msg.user === "string" ? msg.user : (msg.bot_id ?? null),
    type: typeof msg.type === "string" ? msg.type : null,
    subtype: typeof msg.subtype === "string" ? msg.subtype : null,
    text: typeof msg.text === "string" ? msg.text : null,
    edited_ts:
      msg.edited && typeof msg.edited.ts === "string" && msg.edited.ts.length > 0
        ? msg.edited.ts
        : null,
    raw_json: JSON.stringify(msg),
    fetched_at,
  };
}

function dispatchSlackError(method: string, slackErr: string): never {
  if (USER_ERROR_SLACK_ERRORS.has(slackErr)) {
    throw new UserError(`read: ${method} returned ${slackErr}.`);
  }
  throw new TransientError(`read: ${method} returned not-ok (${slackErr}).`);
}

export async function syncChannelHistory(opts: SyncOptions): Promise<void> {
  const { team_id, channel_id, mode, cache_window_days, client, db, now, logger } = opts;

  // 1. mode から fetch oldest と delete-scan oldest を決定。
  //    NMi1: incremental(cache hit) は AND の狭い側 / incremental(cache 空) +
  //    refresh + full-edit-scan は "0"（全 cache を delete-scan 対象にする）。
  let oldest: string;
  let windowOldestForDeleteScan: string;
  if (mode === "refresh" || mode === "full-edit-scan") {
    oldest = "0";
    windowOldestForDeleteScan = "0";
  } else {
    const last_synced =
      channelsDao.getLastSyncedTs(db, team_id, channel_id) ??
      messagesDao.getLatestTs(db, team_id, channel_id);

    if (last_synced === null) {
      // C1 / §13.11: cache 空 incremental は頭から取り、delete-scan も全 cache 範囲。
      oldest = "0";
      windowOldestForDeleteScan = "0";
    } else {
      const window_oldest_sec = Math.max(0, now() - cache_window_days * 86400);
      const window_oldest_ts = `${window_oldest_sec}.000000`;
      const last100 = messagesDao.getLatestN(db, team_id, channel_id, 100);
      const hundredth_ts = last100.length === 100 ? (last100[99]?.ts ?? null) : null;

      // §4.4 / §13.12: fetch range は OR (min)。取りこぼし回避。
      oldest = minStr([last_synced, window_oldest_ts, hundredth_ts].filter(notNull) as string[]);

      // C2 / §13.12: delete-scan range は AND (max)。100 件未満のときは window のみ。
      windowOldestForDeleteScan =
        hundredth_ts === null ? window_oldest_ts : maxStr([window_oldest_ts, hundredth_ts]);
    }
  }

  // 2. window 内で API レスポンスから観測した ts を貯める受け皿。
  const seenTsInWindow = new Set<string>();

  // 3. cursor pagination で history を回す（trx 無し / per-page 即時 upsert）。
  const upsertedTsList: string[] = [];
  let cursor: string | undefined;
  let upsertCount = 0;
  do {
    const params: Parameters<typeof client.conversationsHistory>[0] = {
      channel: channel_id,
      oldest,
      limit: HISTORY_PAGE_LIMIT,
    };
    if (typeof cursor === "string" && cursor.length > 0) {
      params.cursor = cursor;
    }
    let res: ConversationsHistoryResponse;
    try {
      res = (await client.conversationsHistory(params)) as ConversationsHistoryResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TransientError(`read: conversations.history failed: ${msg}`);
    }
    if (res.ok !== true) {
      dispatchSlackError("conversations.history", res.error ?? "unknown");
    }
    const list = res.messages ?? [];
    for (const msg of list) {
      const ts = msg.ts;
      if (typeof ts !== "string" || ts.length === 0) continue;
      if (ts >= windowOldestForDeleteScan) {
        seenTsInWindow.add(ts);
      }
      const existing = messagesDao.get(db, team_id, channel_id, ts);
      messagesDao.upsert(db, mapMessage(team_id, channel_id, msg, now()));
      // M1 / §4.5 / §13.14: API で生存確認できた行は markAlive で deleted=0 に戻す。
      if (existing !== null && existing.deleted === 1) {
        messagesDao.markAlive(db, team_id, channel_id, ts);
      }
      upsertedTsList.push(ts);
      upsertCount++;
    }
    cursor = res.response_metadata?.next_cursor;
  } while (typeof cursor === "string" && cursor.length > 0);

  // 4. delete 検出: window 内で API 未観測 / 既に deleted=0 の row を deleted=1 に。
  //    範囲は windowOldestForDeleteScan に従う。
  const deleteScan = messagesDao.getInRange(db, team_id, channel_id, windowOldestForDeleteScan);
  for (const row of deleteScan) {
    if (!seenTsInWindow.has(row.ts) && row.deleted === 0) {
      messagesDao.markDeleted(db, team_id, channel_id, row.ts);
    }
  }

  // 5. last_synced_ts 更新 (NMi2: 全候補を notNull → maxStr で決定)
  const lastSynced = channelsDao.getLastSyncedTs(db, team_id, channel_id);
  const candidates = [...upsertedTsList, lastSynced].filter(notNull) as string[];
  if (candidates.length > 0) {
    const newest_ts = maxStr(candidates);
    const existingChannel = channelsDao.getOne(db, team_id, channel_id);
    channelsDao.upsert(db, {
      team_id,
      channel_id,
      name: existingChannel?.name ?? null,
      type: existingChannel?.type ?? null,
      topic: existingChannel?.topic ?? null,
      purpose: existingChannel?.purpose ?? null,
      is_member: existingChannel?.is_member ?? null,
      last_synced_ts: newest_ts,
      fetched_at: now(),
    });
  }

  logger.debug(`read.cache: synced ${upsertCount} messages, mode=${mode}`);
}
