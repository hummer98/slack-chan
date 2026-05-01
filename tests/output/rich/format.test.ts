import { describe, expect, it } from "bun:test";
import { getGlyphs } from "../../../src/output/rich/format.ts";

describe("getGlyphs", () => {
  it("ON returns the unicode emoji table", () => {
    const g = getGlyphs(true);
    expect(g.workspaceHeader).toBe("📦");
    expect(g.workspaceListHeader).toBe("🏢");
    expect(g.statsChannels).toBe("💬");
    expect(g.userHeader).toBe("👤");
    expect(g.userEmail).toBe("📧");
    expect(g.threadIndicator).toBe("🧵");
    expect(g.dateHeader).toBe("📅");
    expect(g.downloadOk).toBe("✅");
    expect(g.downloadSkipped).toBe("↺");
  });

  it("OFF replaces decorative glyphs with empty strings", () => {
    const g = getGlyphs(false);
    expect(g.workspaceHeader).toBe("");
    expect(g.statsChannels).toBe("");
    expect(g.userHeader).toBe("");
    expect(g.dateHeader).toBe("");
  });

  it("OFF preserves ASCII-style fallbacks for thread / download markers", () => {
    const g = getGlyphs(false);
    expect(g.threadIndicator).toBe("⤷ thread"); // matches human/timeline
    expect(g.downloadOk).toBe("✓"); // matches human/download
    expect(g.downloadSkipped).toBe("↺");
  });
});
