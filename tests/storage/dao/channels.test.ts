import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as channels from "../../../src/storage/dao/channels.ts";
import { openDatabase } from "../../../src/storage/db.ts";

describe("dao/channels", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  test("upsert + getLastSyncedTs round-trips", () => {
    channels.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: "general",
      type: "public_channel",
      topic: null,
      purpose: null,
      is_member: 1,
      last_synced_ts: "1700000000.000100",
      fetched_at: 1700000050,
    });
    expect(channels.getLastSyncedTs(db, "T1", "C1")).toBe("1700000000.000100");
    expect(channels.getLastSyncedTs(db, "T1", "C-missing")).toBeNull();
  });

  test("upsert called twice updates fields (last write wins)", () => {
    channels.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: "general",
      type: "public_channel",
      topic: "old topic",
      purpose: null,
      is_member: 1,
      last_synced_ts: "1700000000.000100",
      fetched_at: 1700000050,
    });
    channels.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: "general",
      type: "public_channel",
      topic: "new topic",
      purpose: null,
      is_member: 1,
      last_synced_ts: "1700000200.000100",
      fetched_at: 1700000250,
    });

    expect(channels.getLastSyncedTs(db, "T1", "C1")).toBe("1700000200.000100");
    const row = db
      .query<{ topic: string | null; fetched_at: number }, [string, string]>(
        "SELECT topic, fetched_at FROM channels WHERE team_id = ? AND channel_id = ?",
      )
      .get("T1", "C1");
    expect(row?.topic).toBe("new topic");
    expect(row?.fetched_at).toBe(1700000250);
  });

  // T011 Phase 1 — getByName and getOne
  test("(a) getByName returns matching row or null and isolates teams", () => {
    channels.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: "general",
      type: "public_channel",
      topic: null,
      purpose: null,
      is_member: 1,
      last_synced_ts: null,
      fetched_at: 1700000050,
    });
    channels.upsert(db, {
      team_id: "T2",
      channel_id: "C9",
      name: "general",
      type: "public_channel",
      topic: null,
      purpose: null,
      is_member: 1,
      last_synced_ts: null,
      fetched_at: 1700000050,
    });

    expect(channels.getByName(db, "T1", "general")?.channel_id).toBe("C1");
    expect(channels.getByName(db, "T2", "general")?.channel_id).toBe("C9");
    expect(channels.getByName(db, "T1", "missing")).toBeNull();
  });

  test("(b) getByName picks the row with the most recent fetched_at on duplicates (M3)", () => {
    channels.upsert(db, {
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
    channels.upsert(db, {
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

    const hit = channels.getByName(db, "T1", "general");
    expect(hit?.channel_id).toBe("C_NEW");
  });

  test("(c) getByName falls back deterministically when fetched_at is NULL", () => {
    channels.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: "alpha",
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: null,
      fetched_at: null,
    });
    channels.upsert(db, {
      team_id: "T1",
      channel_id: "C2",
      name: "alpha",
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: null,
      fetched_at: 1700000050,
    });

    expect(channels.getByName(db, "T1", "alpha")?.channel_id).toBe("C2");
  });

  test("(d) getOne returns matching channel row or null", () => {
    channels.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: "general",
      type: "public_channel",
      topic: "topic",
      purpose: null,
      is_member: 1,
      last_synced_ts: null,
      fetched_at: 1700000050,
    });
    expect(channels.getOne(db, "T1", "C1")?.name).toBe("general");
    expect(channels.getOne(db, "T1", "C-missing")).toBeNull();
  });

  test("deleteByTeam removes only the matching team's channels", () => {
    channels.upsert(db, {
      team_id: "T1",
      channel_id: "C1",
      name: "general",
      type: "public_channel",
      topic: null,
      purpose: null,
      is_member: 1,
      last_synced_ts: null,
      fetched_at: 1700000050,
    });
    channels.upsert(db, {
      team_id: "T2",
      channel_id: "C1",
      name: "general",
      type: "public_channel",
      topic: null,
      purpose: null,
      is_member: 1,
      last_synced_ts: null,
      fetched_at: 1700000050,
    });
    channels.deleteByTeam(db, "T1");
    const t1 = db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM channels WHERE team_id = ?")
      .get("T1");
    const t2 = db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM channels WHERE team_id = ?")
      .get("T2");
    expect(t1?.n).toBe(0);
    expect(t2?.n).toBe(1);
  });
});
