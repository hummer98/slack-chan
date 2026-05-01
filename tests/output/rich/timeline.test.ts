import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import type { TimelineEntry } from "../../../src/output/human/timeline.ts";
import { getGlyphs } from "../../../src/output/rich/format.ts";
import { formatRichTimeline } from "../../../src/output/rich/timeline.ts";

const colors = makeColors(false);
const glyphsOn = getGlyphs(true);
const glyphsOff = getGlyphs(false);

const baseEntry: TimelineEntry = {
  ts: "1777518023.000000", // 2026-04-30 12:00:23 JST
  channel_label: "#general",
  user_label: "@alice",
  text: "hello world",
  is_thread: false,
  tz: "Asia/Tokyo",
};

describe("formatRichTimeline", () => {
  it("empty input → empty string", () => {
    expect(formatRichTimeline([], colors, glyphsOn)).toBe("");
  });

  it("single entry: 📅 date header, then time + channel + user, then 4-sp body", () => {
    const out = formatRichTimeline([baseEntry], colors, glyphsOn);
    const lines = out.split("\n");
    expect(lines[0]).toBe("📅 2026-04-30");
    expect(lines[1]).toBe("  12:00:23  #general  @alice");
    expect(lines[2]).toBe("    hello world");
  });

  it("emoji-off: date header has no glyph but layout otherwise identical", () => {
    const out = formatRichTimeline([baseEntry], colors, glyphsOff);
    const lines = out.split("\n");
    expect(lines[0]).toBe("2026-04-30");
    expect(lines[1]).toBe("  12:00:23  #general  @alice");
  });

  it("two entries on the same date share a single date header", () => {
    const second: TimelineEntry = { ...baseEntry, ts: "1777518100.000000", text: "second" };
    const out = formatRichTimeline([baseEntry, second], colors, glyphsOn);
    const dateHeaders = out.split("\n").filter((l) => l.startsWith("📅"));
    expect(dateHeaders.length).toBe(1);
    expect(out).toContain("hello world");
    expect(out).toContain("second");
  });

  it("entries on different dates emit one header per date", () => {
    const nextDay: TimelineEntry = {
      ...baseEntry,
      ts: "1777604423.000000", // +1 day in JST
      text: "next",
    };
    const out = formatRichTimeline([baseEntry, nextDay], colors, glyphsOn);
    const dateHeaders = out.split("\n").filter((l) => l.startsWith("📅"));
    expect(dateHeaders.length).toBe(2);
  });

  it("thread indicator (emoji on): 🧵 appended to header", () => {
    const out = formatRichTimeline([{ ...baseEntry, is_thread: true }], colors, glyphsOn);
    const headerLine = out.split("\n")[1] ?? "";
    expect(headerLine).toContain("🧵");
  });

  it("thread indicator (emoji off): falls back to '⤷ thread'", () => {
    const out = formatRichTimeline([{ ...baseEntry, is_thread: true }], colors, glyphsOff);
    const headerLine = out.split("\n")[1] ?? "";
    expect(headerLine).toContain("⤷ thread");
  });

  it("multi-line body indents every line by 4 spaces", () => {
    const out = formatRichTimeline(
      [{ ...baseEntry, text: "line1\nline2\nline3" }],
      colors,
      glyphsOn,
    );
    const lines = out.split("\n");
    expect(lines[2]).toBe("    line1");
    expect(lines[3]).toBe("    line2");
    expect(lines[4]).toBe("    line3");
  });

  it("highlight ranges (colors on) wrap matched text in bold + yellowBg", () => {
    const c = makeColors(true);
    const out = formatRichTimeline(
      [
        {
          ...baseEntry,
          text: "find me",
          highlight: [{ start: 0, end: 4 }],
        },
      ],
      c,
      glyphsOn,
    );
    const ESC = String.fromCharCode(0x1b);
    expect(out).toContain(`${ESC}[43m`); // yellowBg
    expect(out).toContain(`${ESC}[1m`); // bold
  });

  it("null text shows '(no text)' indented", () => {
    const out = formatRichTimeline([{ ...baseEntry, text: null }], colors, glyphsOn);
    expect(out).toContain("(no text)");
  });
});
