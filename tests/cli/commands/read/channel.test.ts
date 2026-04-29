import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { WebClient } from "@slack/web-api";
import { resolveChannelId } from "../../../../src/cli/commands/read/channel.ts";
import { TransientError, UserError } from "../../../../src/cli/errors.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as channelsDao from "../../../../src/storage/dao/channels.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

interface ConvListResp {
  ok: boolean;
  channels?: Array<{
    id?: string;
    name?: string;
    name_normalized?: string;
    is_private?: boolean;
  }>;
  error?: string;
}

function mockConversationsList(handler: (params: unknown) => Promise<ConvListResp>) {
  const proto = WebClient.prototype as unknown as {
    apiCall: (method: string, params?: unknown) => Promise<unknown>;
  };
  return spyOn(proto, "apiCall").mockImplementation(async (method, params) => {
    if (method === "conversations.list") {
      return handler(params);
    }
    throw new Error(`unexpected ${method}`);
  });
}

function newClient(): SlackClient {
  return new SlackClient({ team_id: "T1", token: "xoxb-test" });
}

describe("resolveChannelId", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
    mock.restore();
  });

  it("(1) Cxxx 直指定: API call なしで channels row が upsert される", async () => {
    const apiSpy = mockConversationsList(async () => ({ ok: true, channels: [] }));
    const res = await resolveChannelId({
      team_id: "T1",
      input: "C12345678",
      client: newClient(),
      db,
      now: () => 1700000000,
    });
    expect(res.channel_id).toBe("C12345678");
    expect(res.channel_name).toBeNull();
    expect(apiSpy.mock.calls.length).toBe(0);

    const row = channelsDao.getOne(db, "T1", "C12345678");
    expect(row).not.toBeNull();
    expect(row?.fetched_at).toBe(1700000000);
  });

  it("(2) #general → cache hit (lookup されない)", async () => {
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: "general",
      type: "public_channel",
      topic: null,
      purpose: null,
      is_member: 1,
      last_synced_ts: "1700000000.000100",
      fetched_at: 1700000000,
    });
    const apiSpy = mockConversationsList(async () => ({ ok: true, channels: [] }));
    const res = await resolveChannelId({
      team_id: "T1",
      input: "#general",
      client: newClient(),
      db,
      now: () => 1700000200,
    });
    expect(res.channel_id).toBe("C1");
    expect(res.channel_name).toBe("general");
    expect(apiSpy.mock.calls.length).toBe(0);
  });

  it("(3) general → cache miss → conversations.list で id 解決 + upsert", async () => {
    const apiSpy = mockConversationsList(async () => ({
      ok: true,
      channels: [
        { id: "C99", name: "other" },
        { id: "C42", name: "general", is_private: false },
      ],
    }));
    const res = await resolveChannelId({
      team_id: "T1",
      input: "general",
      client: newClient(),
      db,
      now: () => 1700000500,
    });
    expect(res.channel_id).toBe("C42");
    expect(res.channel_name).toBe("general");
    expect(apiSpy.mock.calls.length).toBe(1);

    const row = channelsDao.getByName(db, "T1", "general");
    expect(row?.channel_id).toBe("C42");
    expect(row?.type).toBe("public_channel");
    expect(row?.fetched_at).toBe(1700000500);
  });

  it("(4) ヒット 0 件 → UserError 'channel ... not found'", async () => {
    mockConversationsList(async () => ({ ok: true, channels: [] }));
    try {
      await resolveChannelId({
        team_id: "T1",
        input: "missing",
        client: newClient(),
        db,
        now: () => 1700000000,
      });
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("channel 'missing' not found");
    }
  });

  it("(5) conversations.list ratelimited → TransientError", async () => {
    mockConversationsList(async () => ({ ok: false, error: "ratelimited" }));
    try {
      await resolveChannelId({
        team_id: "T1",
        input: "general",
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

  it("(6) conversations.list channel_not_found (not-ok) → UserError", async () => {
    mockConversationsList(async () => ({ ok: false, error: "channel_not_found" }));
    try {
      await resolveChannelId({
        team_id: "T1",
        input: "general",
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

  it("(7) name_normalized 一致でも hit する", async () => {
    mockConversationsList(async () => ({
      ok: true,
      channels: [{ id: "C77", name: "ja-name", name_normalized: "team-channel" }],
    }));
    const res = await resolveChannelId({
      team_id: "T1",
      input: "team-channel",
      client: newClient(),
      db,
      now: () => 1700000000,
    });
    expect(res.channel_id).toBe("C77");
  });

  it("(8) M3: 同名 2 行 (古/新 fetched_at) で fetched_at 最新が hit する", async () => {
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C_OLD",
      name: "general",
      type: "public_channel",
      topic: null,
      purpose: null,
      is_member: 0,
      last_synced_ts: "1690000000.000100",
      fetched_at: 1690000000,
    });
    channelsDao.upsert(db, {
      team_id: "T1",
      channel_id: "C_NEW",
      name: "general",
      type: "public_channel",
      topic: null,
      purpose: null,
      is_member: 1,
      last_synced_ts: null,
      fetched_at: 1700000050,
    });
    const apiSpy = mockConversationsList(async () => ({ ok: true, channels: [] }));
    const res = await resolveChannelId({
      team_id: "T1",
      input: "general",
      client: newClient(),
      db,
      now: () => 1700000300,
    });
    expect(res.channel_id).toBe("C_NEW");
    expect(apiSpy.mock.calls.length).toBe(0);
  });

  it("(extra) conversations.list throw → TransientError", async () => {
    const proto = WebClient.prototype as unknown as {
      apiCall: (method: string, params?: unknown) => Promise<unknown>;
    };
    spyOn(proto, "apiCall").mockImplementation(async () => {
      throw new Error("network down");
    });
    try {
      await resolveChannelId({
        team_id: "T1",
        input: "general",
        client: newClient(),
        db,
        now: () => 1700000000,
      });
      throw new Error("expected TransientError");
    } catch (err) {
      expect(err).toBeInstanceOf(TransientError);
      expect((err as Error).message).toContain("conversations.list failed");
    }
  });
});
