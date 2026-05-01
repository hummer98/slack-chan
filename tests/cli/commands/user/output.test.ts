import { describe, expect, it } from "bun:test";
import { renderUser, type UserResult } from "../../../../src/cli/commands/user/output.ts";

function res(overrides: Partial<UserResult["user"]> = {}): UserResult {
  return {
    ok: true,
    user: {
      team_id: "T1",
      user_id: "UD391F0SU",
      name: "rr.yamamoto",
      real_name: "山本 裕司 / Yuji Yamamoto",
      email: "rr.yamamoto@gmail.com",
      profile: {
        display_name: "rr",
        real_name: "山本 裕司 / Yuji Yamamoto",
        email: "rr.yamamoto@gmail.com",
        title: "Flutter/Firebase/税金",
        tz: "Asia/Tokyo",
        tz_label: "Japan Standard Time",
        tz_offset: 32400,
        status_text: "",
        status_emoji: "",
      },
      fetched_at: 0,
      ...overrides,
    },
  };
}

describe("renderUser human format", () => {
  it("full profile renders header + kv", () => {
    const out = renderUser(res(), "human", { isTTY: false });
    expect(out).toContain("@rr.yamamoto  (UD391F0SU)");
    expect(out).toContain("  Real name : 山本 裕司 / Yuji Yamamoto");
    expect(out).toContain("  Email     : rr.yamamoto@gmail.com");
    expect(out).toContain("  Title     : Flutter/Firebase/税金");
    expect(out).toContain("  TZ        : Asia/Tokyo (UTC+9)");
    expect(out).toContain("  Status    : (empty)");
  });

  it("partial profile (no profile object)", () => {
    const out = renderUser(
      {
        ok: true,
        user: {
          team_id: "T1",
          user_id: "U1",
          name: "alice",
          real_name: null,
          email: null,
          profile: null,
          fetched_at: 0,
        },
      },
      "human",
      { isTTY: false },
    );
    expect(out).toContain("@alice  (U1)");
    expect(out).toContain("  Real name : (empty)");
    expect(out).toContain("  Email     : (empty)");
    expect(out).toContain("  Title     : (empty)");
    expect(out).toContain("  TZ        : (empty)");
  });

  it("colors=on bolds the header line", () => {
    const out = renderUser(res(), "human", { isTTY: true });
    expect(out).toMatch(/\[1m/);
  });

  it("jsonl format unchanged: outputs single JSON line", () => {
    const out = renderUser(res(), "jsonl");
    expect(out).toContain('"team_id":"T1"');
    expect(out).toContain('"user_id":"UD391F0SU"');
    expect(out).toContain('"ok":true');
    expect(out.endsWith("\n")).toBe(true);
  });

  it("status_text + status_emoji combined", () => {
    const out = renderUser(
      res({
        profile: {
          tz: "Asia/Tokyo",
          tz_offset: 32400,
          status_text: "in a meeting",
          status_emoji: ":calendar:",
        },
      }),
      "human",
      { isTTY: false },
    );
    expect(out).toContain("Status    : :calendar: in a meeting");
  });
});

describe("renderUser rich format", () => {
  it("full profile with emoji glyphs", () => {
    const out = renderUser(res(), "rich", { isTTY: false, emojiEnabled: true });
    expect(out).toContain("👤 @rr.yamamoto  (UD391F0SU)");
    expect(out).toContain("  🪪 Real name : 山本 裕司 / Yuji Yamamoto");
    expect(out).toContain("  📧 Email     : rr.yamamoto@gmail.com");
    expect(out).toContain("  💼 Title     : Flutter/Firebase/税金");
    expect(out).toContain("  🌏 TZ        : Asia/Tokyo (UTC+9)");
    expect(out).toContain("  💭 Status    : (empty)");
  });

  it("emoji disabled: header has no prefix, KV has no glyph column", () => {
    const out = renderUser(res(), "rich", { isTTY: false, emojiEnabled: false });
    expect(out).toContain("@rr.yamamoto  (UD391F0SU)");
    expect(out).not.toContain("👤");
    expect(out).not.toContain("📧");
    expect(out).toContain("  Real name : 山本 裕司 / Yuji Yamamoto");
  });
});
