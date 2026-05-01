import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { searchFts } from "../../../../src/cli/commands/search/fts.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import { openDatabase } from "../../../../src/storage/db.ts";
import type { MessageUpsertInput } from "../../../../src/storage/types.ts";

function seed(
  db: Database,
  overrides: Partial<MessageUpsertInput> & { text: string; ts: string },
): void {
  const row: MessageUpsertInput = {
    team_id: "T1",
    channel_id: "C1",
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    edited_ts: null,
    raw_json: "{}",
    fetched_at: 1700000000,
    ...overrides,
  };
  messagesDao.upsert(db, row);
}

describe("searchFts", () => {
  let db: Database;
  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });
  afterEach(() => {
    db.close();
  });

  test("(1) basic phrase match returns multiple hits", () => {
    seed(db, { ts: "1700000001.000000", text: "hello world" });
    seed(db, { ts: "1700000002.000000", text: "hello kitty" });
    seed(db, { ts: "1700000003.000000", text: "goodbye" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "hello",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
    const texts = rows.map((r) => r.text).sort();
    expect(texts).toEqual(["hello kitty", "hello world"]);
  });

  test("(2) --in (channel_id) filter narrows results", () => {
    seed(db, { ts: "1700000001.000000", channel_id: "C1", text: "hello team" });
    seed(db, { ts: "1700000002.000000", channel_id: "C2", text: "hello group" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "hello",
      channel_id: "C1",
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.channel_id).toBe("C1");
  });

  test("(3) --from (user_id) filter narrows results", () => {
    seed(db, { ts: "1700000001.000000", user_id: "U1", text: "hello a" });
    seed(db, { ts: "1700000002.000000", user_id: "U2", text: "hello b" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "hello",
      channel_id: null,
      user_id: "U1",
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.user_id).toBe("U1");
  });

  test("(4) --in + --from AND combination", () => {
    seed(db, { ts: "1700000001.000000", channel_id: "C1", user_id: "U1", text: "hello x" });
    seed(db, { ts: "1700000002.000000", channel_id: "C1", user_id: "U2", text: "hello y" });
    seed(db, { ts: "1700000003.000000", channel_id: "C2", user_id: "U1", text: "hello z" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "hello",
      channel_id: "C1",
      user_id: "U1",
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe("hello x");
  });

  test("(5) deleted=1 rows are excluded", () => {
    seed(db, { ts: "1700000001.000000", text: "hello alive" });
    seed(db, { ts: "1700000002.000000", text: "hello deleted" });
    messagesDao.markDeleted(db, "T1", "C1", "1700000002.000000");
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "hello",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe("hello alive");
  });

  test("(6) team_id isolation", () => {
    seed(db, { team_id: "T1", ts: "1700000001.000000", text: "hello a" });
    seed(db, { team_id: "T2", ts: "1700000002.000000", text: "hello b" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "hello",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.team_id).toBe("T1");
  });

  test("(8) bm25 ordering: short matched text comes before long", () => {
    seed(db, { ts: "1700000001.000000", text: "hello" });
    seed(db, {
      ts: "1700000002.000000",
      text: `hello ${"lorem ipsum dolor sit amet ".repeat(20)}`,
    });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "hello",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(2);
    expect(rows[0]?.ts).toBe("1700000001.000000");
  });

  test("(9) LIMIT applied", () => {
    for (let i = 0; i < 100; i++) {
      const tsSec = 1700000000 + i;
      seed(db, { ts: `${tsSec}.000000`, text: `hello ${i}` });
    }
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "hello",
      channel_id: null,
      user_id: null,
      limit: 5,
    });
    expect(rows.length).toBe(5);
  });

  test("(10) phrase escaping: query containing a quote does not raise syntax error", () => {
    seed(db, { ts: "1700000001.000000", text: 'a"b done' });
    seed(db, { ts: "1700000002.000000", text: "no match here" });
    expect(() =>
      searchFts({
        db,
        team_id: "T1",
        query: 'a"b',
        channel_id: null,
        user_id: null,
        limit: 10,
      }),
    ).not.toThrow();
  });

  test("(11) FTS5 operators are treated as literal via phrase form", () => {
    seed(db, { ts: "1700000001.000000", text: "we use OR for fallback" });
    seed(db, { ts: "1700000002.000000", text: "no match" });
    const rows = searchFts({
      db,
      team_id: "T1",
      query: "OR",
      channel_id: null,
      user_id: null,
      limit: 10,
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toContain("OR");
  });
});
