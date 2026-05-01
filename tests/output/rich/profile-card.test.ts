import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import { formatRichProfileCard } from "../../../src/output/rich/profile-card.ts";

const colors = makeColors(false);

describe("formatRichProfileCard", () => {
  it("empty fields: header line only", () => {
    const out = formatRichProfileCard(
      { handle: "alice", user_id: "U123", fields: [], headerGlyph: "👤" },
      colors,
    );
    expect(out).toBe("👤 @alice  (U123)\n");
  });

  it("empty headerGlyph collapses prefix", () => {
    const out = formatRichProfileCard(
      { handle: "alice", user_id: "U123", fields: [], headerGlyph: "" },
      colors,
    );
    expect(out).toBe("@alice  (U123)\n");
  });

  it("with fields: header + bold-aligned KV body", () => {
    const out = formatRichProfileCard(
      {
        handle: "alice",
        user_id: "U123",
        headerGlyph: "👤",
        fields: [
          { label: "Real name", value: "Alice", glyph: "🪪" },
          { label: "Email", value: "a@b.co", glyph: "📧" },
        ],
      },
      colors,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("👤 @alice  (U123)");
    expect(lines[1]).toBe("  🪪 Real name : Alice");
    expect(lines[2]).toBe("  📧 Email     : a@b.co");
  });
});
