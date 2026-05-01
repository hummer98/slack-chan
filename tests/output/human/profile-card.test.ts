import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import { formatProfileCard } from "../../../src/output/human/profile-card.ts";

const colors = makeColors(false);

describe("formatProfileCard", () => {
  it("renders header line + indented kv list", () => {
    const out = formatProfileCard(
      {
        handle: "rr.yamamoto",
        user_id: "UD391F0SU",
        fields: [
          { label: "Real name", value: "山本 裕司 / Yuji Yamamoto" },
          { label: "Email", value: "rr.yamamoto@gmail.com" },
          { label: "Title", value: "Flutter/Firebase/税金" },
          { label: "TZ", value: "Asia/Tokyo (UTC+9)" },
          { label: "Status", value: "(empty)" },
          { label: "Roles", value: "member" },
        ],
      },
      colors,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("@rr.yamamoto  (UD391F0SU)");
    expect(lines[1]).toBe("  Real name : 山本 裕司 / Yuji Yamamoto");
    expect(lines[2]).toBe("  Email     : rr.yamamoto@gmail.com");
    expect(lines[3]).toBe("  Title     : Flutter/Firebase/税金");
    expect(lines[4]).toBe("  TZ        : Asia/Tokyo (UTC+9)");
    expect(lines[5]).toBe("  Status    : (empty)");
    expect(lines[6]).toBe("  Roles     : member");
  });

  it("empty fields → just header line", () => {
    const out = formatProfileCard({ handle: "alice", user_id: "U1", fields: [] }, colors);
    expect(out).toBe("@alice  (U1)\n");
  });

  it("colors=on bolds the header", () => {
    const c = makeColors(true);
    const out = formatProfileCard({ handle: "alice", user_id: "U1", fields: [] }, c);
    expect(out).toMatch(/\[1m/);
  });
});
