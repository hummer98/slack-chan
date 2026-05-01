import { describe, expect, it } from "bun:test";
import { renderStats, type StatsRecord } from "../../../../src/cli/commands/stats/output.ts";

function rec(overrides: Partial<StatsRecord> = {}): StatsRecord {
  return {
    team_id: "T9Q9BSR6C",
    name: "Toranomon",
    channels_total: 1,
    channels_member: 0,
    messages_total: 40,
    messages_alive: 40,
    users: 193,
    files: 0,
    last_synced_ts: "1777076424.000000", // 2026-04-25 09:20:24 JST
    db_size_bytes: 687820,
    ...overrides,
  };
}

describe("renderStats human format", () => {
  it("snapshot of full record (colors=off, fixed now / tz)", () => {
    // now = 2026-04-28 09:20:24 JST (3 days after 2026-04-25)
    const now_ms = 1777335624 * 1000;
    const out = renderStats(rec(), "human", {
      isTTY: false,
      now_ms,
      tz: "Asia/Tokyo",
    });
    const expected =
      "Workspace: Toranomon (T9Q9BSR6C)\n" +
      "  Channels  : 1 (member: 0)\n" +
      "  Messages  : 40 (alive: 40)\n" +
      "  Users     : 193\n" +
      "  Files     : 0\n" +
      "  Last sync : 2026-04-25 09:20:24 (3 days ago)\n" +
      "  DB size   : 671.7 KiB\n";
    expect(out).toBe(expected);
  });

  it("last_synced_ts = null → '(never)'", () => {
    const out = renderStats(rec({ last_synced_ts: null }), "human", {
      isTTY: false,
      now_ms: Date.now(),
      tz: "UTC",
    });
    expect(out).toContain("Last sync : (never)");
  });

  it("jsonl format unchanged (regression)", () => {
    const out = renderStats(rec(), "jsonl");
    expect(out.startsWith("{")).toBe(true);
    expect(out).toContain('"team_id":"T9Q9BSR6C"');
    expect(out).toContain('"db_size_bytes":687820');
  });
});
