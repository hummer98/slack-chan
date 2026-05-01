import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { WebClient } from "@slack/web-api";
import { syncChannelHistory } from "../../../../src/cli/commands/read/cache.ts";
import { TransientError, UserError } from "../../../../src/cli/errors.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as channelsDao from "../../../../src/storage/dao/channels.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import { openDatabase } from "../../../../src/storage/db.ts";
import type { MessageUpsertInput } from "../../../../src/storage/types.ts";

interface ApiHistoryResponse {
  ok: boolean;
  messages?: Array<Record<string, unknown>>;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

type HistoryHandler = (params: Record<string, unknown>) => Promise<ApiHistoryResponse>;

function mockApi(historyHandler: HistoryHandler) {
  const proto = WebClient.prototype as unknown as {
    apiCall: (method: string, params?: unknown) => Promise<unknown>;
  };
  return spyOn(proto, "apiCall").mockImplementation(async (method, params) => {
    if (method === "conversations.history") {
      return historyHandler((params ?? {}) as Record<string, unknown>);
    }
    throw new Error(`unexpected method ${method}`);
  });
}

function newClient(): SlackClient {
  return new SlackClient({ team_id: "T1", token: "xoxb-test" });
}

function seedMsg(db: Database, ts: string, overrides: Partial<MessageUpsertInput> = {}): void {
  messagesDao.upsert(db, {
    team_id: "T1",
    channel_id: "C1",
    ts,
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "seed",
    edited_ts: null,
    raw_json: "{}",
    fetched_at: 1700000000,
    ...overrides,
  });
}

const baseSyncOpts = {
  team_id: "T1",
  channel_id: "C1",
  cache_window_days: 7,
  logger: new StderrLogger(),
};

describe("syncChannelHistory", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
    mock.restore();
  });

  it("(1) incremental cache 空: oldest='0' で 1 page upsert + last_synced_ts=max(ts) (C1)", async () => {
    const apiSpy = mockApi(async () => ({
      ok: true,
      messages: [
        { ts: "1700000000.000100", text: "hello", user: "U1", type: "message" },
        { ts: "1700000000.000200", text: "world", user: "U1", type: "message" },
      ],
      response_metadata: { next_cursor: "" },
    }));
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "incremental",
      client: newClient(),
      db,
      now: () => 1700000300,
    });

    const rows = messagesDao.getInRange(db, "T1", "C1", "0");
    expect(rows.map((r) => r.ts)).toEqual(["1700000000.000100", "1700000000.000200"]);
    expect(channelsDao.getLastSyncedTs(db, "T1", "C1")).toBe("1700000000.000200");

    const calls = apiSpy.mock.calls.filter((c) => c[0] === "conversations.history");
    expect(calls.length).toBe(1);
    expect((calls[0]?.[1] as unknown as { oldest?: string }).oldest).toBe("0");
  });

  it("(1b) incremental 100 件未満: oldest=minStr(last_synced, window_oldest_ts) / windowOldest=window_oldest_ts (C1/C2)", async () => {
    seedMsg(db, "1700000000.000500", { text: "old" });
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: null,
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: "1700000000.000500",
      fetched_at: 1700000000,
    });

    let capturedParams: Record<string, unknown> | null = null;
    mockApi(async (params) => {
      capturedParams = params;
      return { ok: true, messages: [], response_metadata: { next_cursor: "" } };
    });
    const fakeNow = 1700000000 + 10 * 86400; // 10 日後
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "incremental",
      client: newClient(),
      db,
      now: () => fakeNow,
    });
    expect(capturedParams).not.toBeNull();
    const window_oldest_ts = `${fakeNow - 7 * 86400}.000000`;
    // last_synced (1700000000.000500) と window_oldest_ts のうち小さいほう (last_synced)
    expect((capturedParams as unknown as { oldest?: string }).oldest).toBe("1700000000.000500");
    // window_oldest_ts は last_synced より新しいので、min は last_synced。
    expect(window_oldest_ts > "1700000000.000500").toBe(true);
  });

  it("(1c) incremental 100 件以上: oldest=minStr / windowOldest=maxStr(window_oldest_ts, hundredth_ts)", async () => {
    // 100 件ぴったり以上 seed (101 件) — 最古 ts を hundredth_ts にする
    for (let i = 0; i < 101; i++) {
      const ts = `170000${String(1000 + i).padStart(4, "0")}.000000`;
      seedMsg(db, ts, { text: `m${i}` });
    }
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: null,
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: "1700001100.000000",
      fetched_at: 1700001000,
    });
    // hundredth_ts = DESC LIMIT 100 の最後 (100 番目 = 古い側) = 1700001001.000000
    const hundredth_ts = "1700001001.000000";

    let capturedParams: Record<string, unknown> | null = null;
    mockApi(async (params) => {
      capturedParams = params;
      return { ok: true, messages: [], response_metadata: { next_cursor: "" } };
    });
    const fakeNow = 1700001100 + 365 * 86400;
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "incremental",
      client: newClient(),
      db,
      now: () => fakeNow,
    });
    const window_oldest_ts = `${fakeNow - 7 * 86400}.000000`;
    // window_oldest_ts > hundredth_ts (window は新しい側, hundredth_ts は古い側)
    expect(window_oldest_ts > hundredth_ts).toBe(true);
    // → fetch oldest = min(last_synced, window_oldest_ts, hundredth_ts) = hundredth_ts
    expect((capturedParams as unknown as { oldest?: string }).oldest).toBe(hundredth_ts);
  });

  it("(2) incremental cache hit: last_synced_ts 以降を取りつつ window 補完", async () => {
    seedMsg(db, "1700000500.000000", { text: "old" });
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: null,
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: "1700000500.000000",
      fetched_at: 1700000500,
    });
    mockApi(async () => ({
      ok: true,
      messages: [{ ts: "1700000600.000000", text: "new", user: "U1", type: "message" }],
      response_metadata: { next_cursor: "" },
    }));
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "incremental",
      client: newClient(),
      db,
      now: () => 1700000700,
    });
    expect(channelsDao.getLastSyncedTs(db, "T1", "C1")).toBe("1700000600.000000");
    expect(messagesDao.get(db, "T1", "C1", "1700000600.000000")?.text).toBe("new");
  });

  it("(3) cursor pagination: 2 page 続けて呼ばれる + 両方の row が upsert", async () => {
    let call = 0;
    const apiSpy = mockApi(async (_params) => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          messages: [{ ts: "1700000000.000100", text: "p1", user: "U1", type: "message" }],
          response_metadata: { next_cursor: "next-token" },
        };
      }
      return {
        ok: true,
        messages: [{ ts: "1700000000.000200", text: "p2", user: "U1", type: "message" }],
        response_metadata: { next_cursor: "" },
      };
    });
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "incremental",
      client: newClient(),
      db,
      now: () => 1700000300,
    });
    const calls = apiSpy.mock.calls.filter((c) => c[0] === "conversations.history");
    expect(calls.length).toBe(2);
    expect((calls[1]?.[1] as { cursor?: string }).cursor).toBe("next-token");
    const all = messagesDao.getInRange(db, "T1", "C1", "0");
    expect(all.map((r) => r.text)).toEqual(["p1", "p2"]);
  });

  it("(4) edit window: upsert 1 発で text/edited_ts 更新 (Mi4)", async () => {
    seedMsg(db, "1700000000.000100", { text: "before", edited_ts: null });
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: null,
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: "1700000000.000100",
      fetched_at: 1700000000,
    });
    const editedTs = "1700000010.000000";
    mockApi(async () => ({
      ok: true,
      messages: [
        {
          ts: "1700000000.000100",
          text: "after",
          user: "U1",
          type: "message",
          edited: { user: "U1", ts: editedTs },
        },
      ],
      response_metadata: { next_cursor: "" },
    }));
    const editSpy = spyOn(messagesDao, "updateEdited");
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "incremental",
      client: newClient(),
      db,
      now: () => 1700000100,
    });
    // (a) updateEdited は呼ばれていない
    expect(editSpy.mock.calls.length).toBe(0);
    // (b) row の text / edited_ts が API 値と一致
    const row = messagesDao.get(db, "T1", "C1", "1700000000.000100");
    expect(row?.text).toBe("after");
    expect(row?.edited_ts).toBe(editedTs);
  });

  it("(5) delete detection は AND 範囲 (windowOldestForDeleteScan) のみ - window 外の deleted は呼ばれない (§13.12)", async () => {
    // 100 件以上 seed → hundredth_ts は古い側
    for (let i = 0; i < 101; i++) {
      const ts = `170000${String(1000 + i).padStart(4, "0")}.000000`;
      seedMsg(db, ts, { text: `m${i}` });
    }
    // window 外の row を 1 件追加（最古より更に古い）
    seedMsg(db, "1690000000.000000", { text: "ancient" });
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: null,
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: "1700001100.000000",
      fetched_at: 1700001000,
    });

    // hundredth_ts = "1700001001.000000"
    // API が空 → 全 window 内が delete 対象になり得るが、ancient は windowOldestForDeleteScan より古いので対象外
    mockApi(async () => ({ ok: true, messages: [], response_metadata: { next_cursor: "" } }));
    const fakeNow = 1700001100 + 7 * 86400; // window_oldest_ts = 1700001100, hundredth_ts はもっと小さい
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "incremental",
      client: newClient(),
      db,
      now: () => fakeNow,
    });
    // ancient はそのまま deleted=0
    expect(messagesDao.get(db, "T1", "C1", "1690000000.000000")?.deleted).toBe(0);
    // window 内の row は API に含まれないので deleted=1
    const recent = messagesDao.get(db, "T1", "C1", "1700001100.000000");
    expect(recent?.deleted).toBe(1);
  });

  it("(6) markAlive: 既存 deleted=1 row が API に含まれると deleted=0 に復活 (M1)", async () => {
    seedMsg(db, "1700000000.000100", { text: "old" });
    messagesDao.markDeleted(db, "T1", "C1", "1700000000.000100");
    expect(messagesDao.get(db, "T1", "C1", "1700000000.000100")?.deleted).toBe(1);

    mockApi(async () => ({
      ok: true,
      messages: [
        { ts: "1700000000.000100", text: "old (still alive)", user: "U1", type: "message" },
      ],
      response_metadata: { next_cursor: "" },
    }));
    const stats = await syncChannelHistory({
      ...baseSyncOpts,
      mode: "incremental",
      client: newClient(),
      db,
      now: () => 1700000300,
    });
    expect(messagesDao.get(db, "T1", "C1", "1700000000.000100")?.deleted).toBe(0);
    expect(stats.revived).toBe(1);
  });

  it("(7) refresh: oldest='0' + 全 cache が delete-scan 対象", async () => {
    seedMsg(db, "1700000000.000100", { text: "stale" });
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: null,
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: "1700000000.000100",
      fetched_at: 1700000000,
    });

    let captured: Record<string, unknown> | null = null;
    mockApi(async (params) => {
      captured = params;
      return {
        ok: true,
        messages: [{ ts: "1700000500.000000", text: "fresh", user: "U1", type: "message" }],
        response_metadata: { next_cursor: "" },
      };
    });
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "refresh",
      client: newClient(),
      db,
      now: () => 1700001000,
    });
    expect((captured as unknown as { oldest?: string }).oldest).toBe("0");
    // stale は API に含まれないので delete-scan で deleted=1 になる
    expect(messagesDao.get(db, "T1", "C1", "1700000000.000100")?.deleted).toBe(1);
    expect(messagesDao.get(db, "T1", "C1", "1700000500.000000")?.deleted).toBe(0);
  });

  it("(8) full-edit-scan: oldest='0' + 全 cache を markAlive 対象 + 全 cache を delete-scan", async () => {
    // ancient row を deleted=1 で seed
    seedMsg(db, "1690000000.000100", { text: "ancient deleted" });
    messagesDao.markDeleted(db, "T1", "C1", "1690000000.000100");

    let captured: Record<string, unknown> | null = null;
    mockApi(async (params) => {
      captured = params;
      return {
        ok: true,
        messages: [
          {
            ts: "1690000000.000100",
            text: "ancient revived",
            user: "U1",
            type: "message",
          },
        ],
        response_metadata: { next_cursor: "" },
      };
    });
    await syncChannelHistory({
      ...baseSyncOpts,
      mode: "full-edit-scan",
      client: newClient(),
      db,
      now: () => 1700000000,
    });
    expect((captured as unknown as { oldest?: string }).oldest).toBe("0");
    // ancient は markAlive で deleted=0 に戻る
    expect(messagesDao.get(db, "T1", "C1", "1690000000.000100")?.deleted).toBe(0);
    expect(messagesDao.get(db, "T1", "C1", "1690000000.000100")?.text).toBe("ancient revived");
  });

  it("(9) conversations.history channel_not_found → UserError", async () => {
    mockApi(async () => ({ ok: false, error: "channel_not_found" }));
    try {
      await syncChannelHistory({
        ...baseSyncOpts,
        mode: "incremental",
        client: newClient(),
        db,
        now: () => 1700000000,
      });
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("channel_not_found");
    }
  });

  it("(10) conversations.history throw → TransientError", async () => {
    const proto = WebClient.prototype as unknown as {
      apiCall: (method: string, params?: unknown) => Promise<unknown>;
    };
    spyOn(proto, "apiCall").mockImplementation(async () => {
      throw new Error("ECONNRESET");
    });
    try {
      await syncChannelHistory({
        ...baseSyncOpts,
        mode: "incremental",
        client: newClient(),
        db,
        now: () => 1700000000,
      });
      throw new Error("expected TransientError");
    } catch (err) {
      expect(err).toBeInstanceOf(TransientError);
      expect((err as Error).message).toContain("conversations.history failed");
    }
  });

  it("(12) returns SyncStats with upserted/deletedMarked/revived/lastSyncedTs", async () => {
    // 既存 deleted=1 row 1 件と alive な row 1 件 を seed
    seedMsg(db, "1700000000.000100", { text: "old-deleted" });
    messagesDao.markDeleted(db, "T1", "C1", "1700000000.000100");
    seedMsg(db, "1700000000.000200", { text: "stale-alive" });
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: null,
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: "1700000000.000200",
      fetched_at: 1700000000,
    });

    // API: 既存 deleted=1 と新規 1 件を返す（古い alive 1 件は API 未観測 → markDeleted）
    mockApi(async () => ({
      ok: true,
      messages: [
        { ts: "1700000000.000100", text: "revived", user: "U1", type: "message" },
        { ts: "1700000000.000300", text: "fresh", user: "U1", type: "message" },
      ],
      response_metadata: { next_cursor: "" },
    }));
    const stats = await syncChannelHistory({
      ...baseSyncOpts,
      mode: "refresh",
      client: newClient(),
      db,
      now: () => 1700000400,
    });
    expect(stats.upserted).toBe(2);
    expect(stats.revived).toBe(1);
    expect(stats.deletedMarked).toBe(1);
    expect(stats.lastSyncedTs).toBe("1700000000.000300");
  });

  it("(11) ratelimited → TransientError", async () => {
    mockApi(async () => ({ ok: false, error: "ratelimited" }));
    try {
      await syncChannelHistory({
        ...baseSyncOpts,
        mode: "incremental",
        client: newClient(),
        db,
        now: () => 1700000000,
      });
      throw new Error("expected TransientError");
    } catch (err) {
      expect(err).toBeInstanceOf(TransientError);
      expect((err as Error).message).toContain("not-ok (ratelimited)");
    }
  });
});
