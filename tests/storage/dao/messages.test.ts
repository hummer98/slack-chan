import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as messages from "../../../src/storage/dao/messages.ts";
import { openDatabase } from "../../../src/storage/db.ts";
import type { MessageUpsertInput } from "../../../src/storage/types.ts";

function makeRow(overrides: Partial<MessageUpsertInput> = {}): MessageUpsertInput {
  return {
    team_id: "T1",
    channel_id: "C1",
    ts: "1700000000.000100",
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "hello world",
    edited_ts: null,
    raw_json: '{"text":"hello world"}',
    fetched_at: 1700000050,
    ...overrides,
  };
}

describe("dao/messages", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  test("upsert + getAfterTs round-trips and orders ascending by ts", () => {
    messages.upsert(db, makeRow({ ts: "1700000000.000200", text: "second" }));
    messages.upsert(db, makeRow({ ts: "1700000000.000100", text: "first" }));
    messages.upsert(db, makeRow({ ts: "1700000000.000300", text: "third" }));

    const rows = messages.getAfterTs(db, "T1", "C1", "0");
    expect(rows.map((r) => r.text)).toEqual(["first", "second", "third"]);
    expect(rows[0]?.deleted).toBe(0);
  });

  test("limit option restricts rows returned", () => {
    for (let i = 1; i <= 5; i++) {
      messages.upsert(db, makeRow({ ts: `170000000${i}.000000`, text: `t${i}` }));
    }
    const rows = messages.getAfterTs(db, "T1", "C1", "0", { limit: 2 });
    expect(rows.length).toBe(2);
    expect(rows[0]?.text).toBe("t1");
    expect(rows[1]?.text).toBe("t2");
  });

  test("markDeleted hides row by default and includeDeleted=true exposes it", () => {
    messages.upsert(db, makeRow({ ts: "1700000000.000100", text: "alive" }));
    messages.upsert(db, makeRow({ ts: "1700000000.000200", text: "doomed" }));

    messages.markDeleted(db, "T1", "C1", "1700000000.000200");

    const visible = messages.getAfterTs(db, "T1", "C1", "0");
    expect(visible.length).toBe(1);
    expect(visible[0]?.text).toBe("alive");

    const all = messages.getAfterTs(db, "T1", "C1", "0", { includeDeleted: true });
    expect(all.length).toBe(2);
    const dead = all.find((r) => r.ts === "1700000000.000200");
    expect(dead?.deleted).toBe(1);
  });

  test("re-upsert after markDeleted keeps deleted=1 (Recommendation 1)", () => {
    messages.upsert(db, makeRow({ ts: "1700000000.000100", text: "v1" }));
    messages.markDeleted(db, "T1", "C1", "1700000000.000100");
    messages.upsert(db, makeRow({ ts: "1700000000.000100", text: "v2" }));

    const all = messages.getAfterTs(db, "T1", "C1", "0", { includeDeleted: true });
    expect(all.length).toBe(1);
    expect(all[0]?.deleted).toBe(1);
    expect(all[0]?.text).toBe("v2");
  });

  test("updateEdited updates text and edited_ts", () => {
    messages.upsert(db, makeRow({ ts: "1700000000.000100", text: "before" }));
    messages.updateEdited(db, "T1", "C1", "1700000000.000100", {
      text: "after",
      edited_ts: "1700000010.000000",
    });
    const rows = messages.getAfterTs(db, "T1", "C1", "0");
    expect(rows[0]?.text).toBe("after");
    expect(rows[0]?.edited_ts).toBe("1700000010.000000");
  });

  test("FTS5 trigger keeps messages_fts in sync on upsert / update / delete", () => {
    messages.upsert(db, makeRow({ ts: "1700000000.000100", text: "alpha keyword" }));

    const matchAlpha = db
      .query<{ rowid: number }, [string]>(
        "SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?",
      )
      .all("alpha");
    expect(matchAlpha.length).toBe(1);

    messages.updateEdited(db, "T1", "C1", "1700000000.000100", {
      text: "beta replaced",
      edited_ts: "1700000010.000000",
    });

    const matchAlphaAfter = db
      .query<{ rowid: number }, [string]>(
        "SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?",
      )
      .all("alpha");
    expect(matchAlphaAfter.length).toBe(0);

    const matchBeta = db
      .query<{ rowid: number }, [string]>(
        "SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?",
      )
      .all("beta");
    expect(matchBeta.length).toBe(1);

    db.prepare("DELETE FROM messages WHERE team_id = ? AND channel_id = ? AND ts = ?").run(
      "T1",
      "C1",
      "1700000000.000100",
    );

    const matchBetaAfterDelete = db
      .query<{ rowid: number }, [string]>(
        "SELECT rowid FROM messages_fts WHERE messages_fts MATCH ?",
      )
      .all("beta");
    expect(matchBetaAfterDelete.length).toBe(0);
  });

  test("upsert tolerates NULL text without throwing (FTS5 NULL handling)", () => {
    messages.upsert(db, makeRow({ ts: "1700000000.000100", text: null }));
    const rows = messages.getAfterTs(db, "T1", "C1", "0");
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBeNull();
  });

  test("deleteByTeam removes only the matching team's rows", () => {
    messages.upsert(db, makeRow({ team_id: "T1", ts: "1700000000.000100", text: "t1" }));
    messages.upsert(db, makeRow({ team_id: "T2", ts: "1700000000.000100", text: "t2" }));
    messages.deleteByTeam(db, "T1");
    expect(messages.getAfterTs(db, "T1", "C1", "0").length).toBe(0);
    expect(messages.getAfterTs(db, "T2", "C1", "0").length).toBe(1);
  });

  test("get returns the row when (team_id, channel_id, ts) matches", () => {
    messages.upsert(db, makeRow({ ts: "1700000000.000100", text: "hit" }));
    const row = messages.get(db, "T1", "C1", "1700000000.000100");
    expect(row?.text).toBe("hit");
    expect(row?.deleted).toBe(0);
  });

  test("get returns null when no row matches", () => {
    expect(messages.get(db, "T1", "C1", "9999999999.000000")).toBeNull();
  });

  test("getByTs returns rows scoped to (team_id, ts) up to LIMIT 2", () => {
    // Same ts in two different channels — Slack does not actually allow this,
    // but `getByTs` is the cache fallback used when channel is unknown so we
    // need to surface the ambiguity (LIMIT 2 lets the caller decide).
    messages.upsert(db, makeRow({ channel_id: "C1", ts: "1700000000.000100", text: "in-c1" }));
    messages.upsert(db, makeRow({ channel_id: "C2", ts: "1700000000.000100", text: "in-c2" }));
    // Different ts, must not show up.
    messages.upsert(db, makeRow({ channel_id: "C3", ts: "1700000000.000200", text: "other" }));
    const rows = messages.getByTs(db, "T1", "1700000000.000100");
    expect(rows.length).toBe(2);
    const channels = rows.map((r) => r.channel_id).sort();
    expect(channels).toEqual(["C1", "C2"]);
  });

  test("getByTs returns one row for a single hit and empty array for miss", () => {
    messages.upsert(db, makeRow({ channel_id: "C1", ts: "1700000000.000100", text: "only" }));
    expect(messages.getByTs(db, "T1", "1700000000.000100").length).toBe(1);
    expect(messages.getByTs(db, "T1", "9999999999.000000")).toEqual([]);
  });
});
