import { describe, expect, it } from "bun:test";
import { PassThrough } from "node:stream";
import type { MergedHit } from "../../../../src/cli/commands/search/merge.ts";
import {
  extractQueryTokens,
  renderSearchHumanFromHits,
  writeSearchOutput,
} from "../../../../src/cli/commands/search/output.ts";
import * as channelsDao from "../../../../src/storage/dao/channels.ts";
import * as usersDao from "../../../../src/storage/dao/users.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

const TEAM = "T9Q9BSR6C";

function hit(overrides: Partial<MergedHit> = {}): MergedHit {
  return {
    team_id: TEAM,
    channel_id: "C01",
    ts: "1777518023.000000",
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "find me here",
    edited_ts: null,
    deleted: false,
    source: "cache",
    permalink: null,
    ...overrides,
  };
}

function setupDb() {
  const db = openDatabase({ path: ":memory:" });
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
  return db;
}

describe("extractQueryTokens", () => {
  it("simple words", () => {
    expect(extractQueryTokens("foo bar")).toEqual(["foo", "bar"]);
  });

  it("strips operators", () => {
    expect(extractQueryTokens("channel:#general from:@alice hello world")).toEqual([
      "hello",
      "world",
    ]);
  });

  it("phrase quotes are kept as a single token", () => {
    expect(extractQueryTokens('foo "hello world" bar')).toEqual(["hello world", "foo", "bar"]);
  });

  it("blank input → []", () => {
    expect(extractQueryTokens("")).toEqual([]);
    expect(extractQueryTokens("   ")).toEqual([]);
  });
});

describe("writeSearchOutput / human format", () => {
  it("empty merged → no write", () => {
    const stdout = new PassThrough();
    const db = setupDb();
    try {
      writeSearchOutput({
        merged: [],
        format: "human",
        stdout,
        query: "find",
        team_id: TEAM,
        db,
      });
      const buf = stdout.read();
      expect(buf).toBeNull();
    } finally {
      db.close();
    }
  });

  it("colors=off, single hit: timeline format", () => {
    const db = setupDb();
    try {
      const out = renderSearchHumanFromHits([hit({})], {
        team_id: TEAM,
        db,
        query: "find",
        isTTY: false,
        tz: "Asia/Tokyo",
      });
      expect(out).toBe("2026-04-30 12:00:23  #general  @alice\n  find me here\n");
    } finally {
      db.close();
    }
  });

  it("colors=on with matching token: highlight wraps the match with bold + yellowBg", () => {
    const db = setupDb();
    try {
      const out = renderSearchHumanFromHits([hit({})], {
        team_id: TEAM,
        db,
        query: "find",
        isTTY: true,
        tz: "Asia/Tokyo",
      });
      expect(out).toMatch(/\[43m/); // yellowBg open
      expect(out).toMatch(/\[1m/); // bold open
      expect(out).toContain("find");
    } finally {
      db.close();
    }
  });

  it("token absent in text → no highlight escapes", () => {
    const db = setupDb();
    try {
      const out = renderSearchHumanFromHits([hit({ text: "no match here" })], {
        team_id: TEAM,
        db,
        query: "absent",
        isTTY: true,
        tz: "Asia/Tokyo",
      });
      expect(out).not.toMatch(/\[43m/);
    } finally {
      db.close();
    }
  });

  it("operator-only query → no highlight applied", () => {
    const db = setupDb();
    try {
      const out = renderSearchHumanFromHits([hit({ text: "channel:foo bar" })], {
        team_id: TEAM,
        db,
        query: "channel:foo",
        isTTY: true,
        tz: "Asia/Tokyo",
      });
      expect(out).not.toMatch(/\[43m/);
    } finally {
      db.close();
    }
  });

  it("jsonl format unchanged (regression)", () => {
    const stdout = new PassThrough();
    const db = setupDb();
    try {
      writeSearchOutput({
        merged: [hit({})],
        format: "jsonl",
        stdout,
        team_id: TEAM,
        db,
      });
      let s = "";
      for (let chunk: unknown = stdout.read(); chunk !== null; chunk = stdout.read()) {
        s += String(chunk);
      }
      expect(s).toContain('"text":"find me here"');
      expect(s).toContain('"source":"cache"');
    } finally {
      db.close();
    }
  });
});
