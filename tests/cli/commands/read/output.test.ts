import { describe, expect, it } from "bun:test";
import { renderMessagesHuman } from "../../../../src/cli/commands/read/output.ts";
import * as channelsDao from "../../../../src/storage/dao/channels.ts";
import * as usersDao from "../../../../src/storage/dao/users.ts";
import { openDatabase } from "../../../../src/storage/db.ts";
import type { MessageRow } from "../../../../src/storage/types.ts";

const TEAM = "T9Q9BSR6C";

function row(overrides: Partial<MessageRow>): MessageRow {
  return {
    team_id: TEAM,
    channel_id: "C01",
    ts: "1777518023.000000", // 2026-04-30 12:00:23 JST
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "hello",
    edited_ts: null,
    deleted: 0,
    raw_json: "{}",
    fetched_at: 0,
    ...overrides,
  };
}

describe("renderMessagesHuman", () => {
  it("resolves channel + user names from DAO and emits timeline", () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      channelsDao.upsert(db, {
        team_id: TEAM,
        channel_id: "C01",
        name: "general",
        type: "public_channel",
        topic: null,
        purpose: null,
        is_member: 1,
        last_synced_ts: null,
        fetched_at: 0,
      });
      usersDao.upsert(db, {
        team_id: TEAM,
        user_id: "U1",
        name: "alice",
        real_name: "Alice",
        email: null,
        profile_json: null,
        fetched_at: 0,
      });
      const out = renderMessagesHuman([row({})], {
        team_id: TEAM,
        db,
        isTTY: false,
        tz: "Asia/Tokyo",
      });
      expect(out).toBe("2026-04-30 12:00:23  #general  @alice\n  hello\n");
    } finally {
      db.close();
    }
  });

  it("falls back to raw IDs when name is unresolved", () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      const out = renderMessagesHuman([row({ user_id: "U_UNKNOWN", channel_id: "C_UNK" })], {
        team_id: TEAM,
        db,
        isTTY: false,
        tz: "Asia/Tokyo",
      });
      expect(out).toContain("C_UNK");
      expect(out).toContain("U_UNKNOWN");
    } finally {
      db.close();
    }
  });

  it("IM channel renders as @<name>", () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      channelsDao.upsert(db, {
        team_id: TEAM,
        channel_id: "D01",
        name: "alice",
        type: "im",
        topic: null,
        purpose: null,
        is_member: 1,
        last_synced_ts: null,
        fetched_at: 0,
      });
      const out = renderMessagesHuman([row({ channel_id: "D01", user_id: "U1" })], {
        team_id: TEAM,
        db,
        isTTY: false,
        tz: "Asia/Tokyo",
      });
      expect(out).toContain("@alice");
      expect(out).not.toContain("#alice");
    } finally {
      db.close();
    }
  });

  it("thread reply gets ⤷ thread indicator", () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      const out = renderMessagesHuman([row({ thread_ts: "1777518000.000000" })], {
        team_id: TEAM,
        db,
        isTTY: false,
        tz: "Asia/Tokyo",
      });
      expect(out).toContain("⤷ thread");
    } finally {
      db.close();
    }
  });

  it("colors=off → no ANSI escapes", () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      const out = renderMessagesHuman([row({})], {
        team_id: TEAM,
        db,
        isTTY: false,
        tz: "Asia/Tokyo",
      });
      const ESC = String.fromCharCode(0x1b);
      expect(out.includes(ESC)).toBe(false);
    } finally {
      db.close();
    }
  });

  it("empty rows → empty string", () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      const out = renderMessagesHuman([], {
        team_id: TEAM,
        db,
        isTTY: false,
        tz: "Asia/Tokyo",
      });
      expect(out).toBe("");
    } finally {
      db.close();
    }
  });
});
