import { describe, expect, test } from "bun:test";
import { mergeHits } from "../../../../src/cli/commands/search/merge.ts";
import type { RemoteSearchHit } from "../../../../src/cli/commands/search/remote.ts";
import type { MessageRow } from "../../../../src/storage/types.ts";

function row(overrides: Partial<MessageRow> & { ts: string; channel_id: string }): MessageRow {
  return {
    team_id: "T1",
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "cache-text",
    edited_ts: null,
    deleted: 0,
    raw_json: "{}",
    fetched_at: 1700000000,
    ...overrides,
  };
}

function rhit(
  overrides: Partial<RemoteSearchHit> & { ts: string; channel_id: string },
): RemoteSearchHit {
  return {
    user_id: "U2",
    text: "remote-text",
    permalink: "https://example.com/x",
    raw_match: {},
    ...overrides,
  };
}

describe("mergeHits", () => {
  test("(1) empty input -> empty array", () => {
    const out = mergeHits({ team_id: "T1", fts: [], remote: [], limit: 10 });
    expect(out).toEqual([]);
  });

  test("(2) cache only", () => {
    const fts = [
      row({ ts: "1700000003.000000", channel_id: "C1" }),
      row({ ts: "1700000002.000000", channel_id: "C1" }),
      row({ ts: "1700000001.000000", channel_id: "C1" }),
    ];
    const out = mergeHits({ team_id: "T1", fts, remote: [], limit: 10 });
    expect(out.length).toBe(3);
    for (const h of out) expect(h.source).toBe("cache");
  });

  test("(3) remote only", () => {
    const remote = [
      rhit({ ts: "1700000003.000000", channel_id: "C1" }),
      rhit({ ts: "1700000002.000000", channel_id: "C1" }),
    ];
    const out = mergeHits({ team_id: "T1", fts: [], remote, limit: 10 });
    expect(out.length).toBe(2);
    for (const h of out) expect(h.source).toBe("remote");
  });

  test('(4) duplicate (channel_id, ts) -> single hit, source="both", cache text + remote permalink', () => {
    const fts = [row({ ts: "1700000001.000000", channel_id: "C1", text: "from cache" })];
    const remote = [
      rhit({
        ts: "1700000001.000000",
        channel_id: "C1",
        text: "from remote",
        permalink: "https://example.com/perm",
      }),
    ];
    const out = mergeHits({ team_id: "T1", fts, remote, limit: 10 });
    expect(out.length).toBe(1);
    expect(out[0]?.source).toBe("both");
    expect(out[0]?.text).toBe("from cache");
    expect(out[0]?.permalink).toBe("https://example.com/perm");
  });

  test("(5) ordering ts DESC", () => {
    const fts = [
      row({ ts: "1700000001.000000", channel_id: "C1" }),
      row({ ts: "1700000003.000000", channel_id: "C1" }),
      row({ ts: "1700000002.000000", channel_id: "C1" }),
    ];
    const out = mergeHits({ team_id: "T1", fts, remote: [], limit: 10 });
    expect(out.map((h) => h.ts)).toEqual([
      "1700000003.000000",
      "1700000002.000000",
      "1700000001.000000",
    ]);
  });

  test("(6) limit applied after dedupe", () => {
    const fts: MessageRow[] = [];
    for (let i = 0; i < 10; i++) {
      const tsSec = 1700000000 + i;
      fts.push(row({ ts: `${tsSec}.000000`, channel_id: "C1" }));
    }
    const out = mergeHits({ team_id: "T1", fts, remote: [], limit: 3 });
    expect(out.length).toBe(3);
    expect(out[0]?.ts).toBe("1700000009.000000");
  });

  test("(7) same ts but different channel -> separate hits", () => {
    const fts = [
      row({ ts: "1700000001.000000", channel_id: "C1" }),
      row({ ts: "1700000001.000000", channel_id: "C2" }),
    ];
    const out = mergeHits({ team_id: "T1", fts, remote: [], limit: 10 });
    expect(out.length).toBe(2);
  });
});
