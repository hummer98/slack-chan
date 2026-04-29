import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { WebClient } from "@slack/web-api";
import { syncThreadReplies } from "../../../../src/cli/commands/read/thread.ts";
import { TransientError } from "../../../../src/cli/errors.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

interface RepliesResp {
  ok: boolean;
  messages?: Array<Record<string, unknown>>;
  response_metadata?: { next_cursor?: string };
  error?: string;
}

function mockReplies(handler: (params: Record<string, unknown>) => Promise<RepliesResp>) {
  const proto = WebClient.prototype as unknown as {
    apiCall: (method: string, params?: unknown) => Promise<unknown>;
  };
  return spyOn(proto, "apiCall").mockImplementation(async (method, params) => {
    if (method === "conversations.replies") {
      return handler((params ?? {}) as Record<string, unknown>);
    }
    throw new Error(`unexpected ${method}`);
  });
}

function newClient(): SlackClient {
  return new SlackClient({ team_id: "T1", token: "xoxb-test" });
}

const PARENT_TS = "1700000000.000100";
const REPLY1 = "1700000000.000200";
const REPLY2 = "1700000000.000300";

const baseOpts = {
  team_id: "T1",
  channel_id: "C1",
  thread_ts: PARENT_TS,
  logger: new StderrLogger(),
};

describe("syncThreadReplies", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
    mock.restore();
  });

  it("(1) --thread=<ts> で conversations.replies 呼ばれる", async () => {
    let captured: Record<string, unknown> | null = null;
    const apiSpy = mockReplies(async (params) => {
      captured = params;
      return {
        ok: true,
        messages: [
          { ts: PARENT_TS, thread_ts: PARENT_TS, text: "parent", user: "U1", type: "message" },
        ],
        response_metadata: { next_cursor: "" },
      };
    });
    await syncThreadReplies({
      ...baseOpts,
      client: newClient(),
      db,
      now: () => 1700000000,
    });
    expect(apiSpy.mock.calls.length).toBe(1);
    expect((captured as unknown as { ts?: string; channel?: string }).ts).toBe(PARENT_TS);
    expect((captured as unknown as { channel?: string }).channel).toBe("C1");
  });

  it("(2) replies 全件 cache 書き込み（親 + replies）", async () => {
    mockReplies(async () => ({
      ok: true,
      messages: [
        { ts: PARENT_TS, text: "parent", user: "U1", type: "message" }, // 親 thread_ts なし
        { ts: REPLY1, thread_ts: PARENT_TS, text: "r1", user: "U2", type: "message" },
        { ts: REPLY2, thread_ts: PARENT_TS, text: "r2", user: "U3", type: "message" },
      ],
      response_metadata: { next_cursor: "" },
    }));
    await syncThreadReplies({
      ...baseOpts,
      client: newClient(),
      db,
      now: () => 1700000000,
    });
    const parent = messagesDao.get(db, "T1", "C1", PARENT_TS);
    expect(parent?.text).toBe("parent");
    // 親も thread_ts=PARENT_TS で保存されている (getThread が拾うため)
    expect(parent?.thread_ts).toBe(PARENT_TS);
    expect(messagesDao.get(db, "T1", "C1", REPLY1)?.thread_ts).toBe(PARENT_TS);
    expect(messagesDao.get(db, "T1", "C1", REPLY2)?.thread_ts).toBe(PARENT_TS);
  });

  it("(3) cursor pagination: 2 page", async () => {
    let call = 0;
    const apiSpy = mockReplies(async () => {
      call++;
      if (call === 1) {
        return {
          ok: true,
          messages: [{ ts: PARENT_TS, text: "parent", user: "U1", type: "message" }],
          response_metadata: { next_cursor: "tok" },
        };
      }
      return {
        ok: true,
        messages: [{ ts: REPLY1, thread_ts: PARENT_TS, text: "r1", user: "U2", type: "message" }],
        response_metadata: { next_cursor: "" },
      };
    });
    await syncThreadReplies({
      ...baseOpts,
      client: newClient(),
      db,
      now: () => 1700000000,
    });
    const calls = apiSpy.mock.calls.filter((c) => c[0] === "conversations.replies");
    expect(calls.length).toBe(2);
    expect((calls[1]?.[1] as unknown as { cursor?: string }).cursor).toBe("tok");
  });

  it("(4) getThread で読むと親 + replies が ts 昇順で返る", async () => {
    mockReplies(async () => ({
      ok: true,
      messages: [
        { ts: PARENT_TS, text: "parent", user: "U1", type: "message" },
        { ts: REPLY2, thread_ts: PARENT_TS, text: "r2", user: "U3", type: "message" },
        { ts: REPLY1, thread_ts: PARENT_TS, text: "r1", user: "U2", type: "message" },
      ],
      response_metadata: { next_cursor: "" },
    }));
    await syncThreadReplies({
      ...baseOpts,
      client: newClient(),
      db,
      now: () => 1700000000,
    });
    const got = messagesDao.getThread(db, "T1", "C1", PARENT_TS);
    expect(got.map((r) => r.text)).toEqual(["parent", "r1", "r2"]);
  });

  it("(5) replies が ratelimited → TransientError", async () => {
    mockReplies(async () => ({ ok: false, error: "ratelimited" }));
    try {
      await syncThreadReplies({
        ...baseOpts,
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

  it("(6) 既存 replies row の edited_ts が更新される", async () => {
    messagesDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      ts: REPLY1,
      thread_ts: PARENT_TS,
      user_id: "U2",
      type: "message",
      subtype: null,
      text: "before",
      edited_ts: null,
      raw_json: "{}",
      fetched_at: 1700000000,
    });
    const editedTs = "1700000010.000000";
    mockReplies(async () => ({
      ok: true,
      messages: [
        {
          ts: REPLY1,
          thread_ts: PARENT_TS,
          text: "after",
          user: "U2",
          type: "message",
          edited: { user: "U2", ts: editedTs },
        },
      ],
      response_metadata: { next_cursor: "" },
    }));
    await syncThreadReplies({
      ...baseOpts,
      client: newClient(),
      db,
      now: () => 1700000200,
    });
    const row = messagesDao.get(db, "T1", "C1", REPLY1);
    expect(row?.text).toBe("after");
    expect(row?.edited_ts).toBe(editedTs);
  });
});
