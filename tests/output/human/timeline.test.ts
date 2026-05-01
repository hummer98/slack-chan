import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import { formatTimeline, type TimelineEntry } from "../../../src/output/human/timeline.ts";

const colors = makeColors(false);

const baseEntry: TimelineEntry = {
  ts: "1777518023.000000", // 2026-04-30 12:00:23 JST
  channel_label: "#general",
  user_label: "@alice",
  text: "hello world",
  is_thread: false,
  tz: "Asia/Tokyo",
};

describe("formatTimeline", () => {
  it("empty input → empty string", () => {
    expect(formatTimeline([], colors)).toBe("");
  });

  it("single entry: ts + channel + user header line, then indented body", () => {
    const out = formatTimeline([baseEntry], colors);
    expect(out).toBe("2026-04-30 12:00:23  #general  @alice\n  hello world\n");
  });

  it("multiple entries are separated by a blank line", () => {
    const second: TimelineEntry = {
      ...baseEntry,
      ts: "1777518100.000000",
      text: "second",
    };
    const out = formatTimeline([baseEntry, second], colors);
    expect(out).toContain("hello world");
    expect(out).toContain("second");
    // Separator between entries: blank line between bodies
    const lines = out.split("\n");
    // [hdr1, body1, "", hdr2, body2, ""]
    expect(lines[0]).toContain("hello world".length > 0 ? "@alice" : "");
    expect(lines[1]).toBe("  hello world");
    expect(lines[2]).toBe("");
    expect(lines[3]).toContain("@alice");
    expect(lines[4]).toBe("  second");
  });

  it("thread indicator appended to header when is_thread=true", () => {
    const out = formatTimeline([{ ...baseEntry, is_thread: true }], colors);
    expect(out.split("\n")[0]).toBe("2026-04-30 12:00:23  #general  @alice  ⤷ thread");
  });

  it("multi-line text indented by 2 spaces per line", () => {
    const out = formatTimeline([{ ...baseEntry, text: "line1\nline2\nline3" }], colors);
    const lines = out.split("\n");
    expect(lines[1]).toBe("  line1");
    expect(lines[2]).toBe("  line2");
    expect(lines[3]).toBe("  line3");
  });

  it("null text shows '(no text)' (dim with colors=on)", () => {
    const out = formatTimeline([{ ...baseEntry, text: null }], colors);
    expect(out).toContain("(no text)");
  });

  it("highlight ranges wrap with bold + yellowBg when colors=on", () => {
    const c = makeColors(true);
    const out = formatTimeline(
      [
        {
          ...baseEntry,
          text: "find me",
          highlight: [{ start: 0, end: 4 }], // "find"
        },
      ],
      c,
    );
    // Should contain ANSI escape for yellowBg (43m) on the body line
    const ESC = String.fromCharCode(0x1b);
    expect(out).toContain(`${ESC}[43m`);
    expect(out).toContain("find");
    expect(out).toContain("me");
  });
});
