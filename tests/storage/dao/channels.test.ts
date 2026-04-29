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
});
