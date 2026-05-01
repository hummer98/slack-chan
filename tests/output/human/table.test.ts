import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import { formatTable } from "../../../src/output/human/table.ts";

const colors = makeColors(false);

describe("formatTable", () => {
  it("empty rows still emits header + separator", () => {
    const out = formatTable(["A", "B"], [], colors);
    const lines = out.split("\n");
    expect(lines[0]).toBe("A  B");
    // Separator: each col content width (no padding)
    expect(lines[1]).toBe("─  ─");
    expect(lines[2]).toBe("");
    expect(out.endsWith("\n")).toBe(true);
  });

  it("3 cols / sample width=5,8,3 / padding=2 between cols (trailing trimmed)", () => {
    // headers length 5, 8, 3
    const out = formatTable(
      ["AAAAA", "BBBBBBBB", "CCC"],
      [
        ["1", "2", "3"],
        ["xx", "yy", "zz"],
      ],
      colors,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("AAAAA  BBBBBBBB  CCC");
    // ─ separator: 5, 8, 3 chars (content widths, no padding)
    expect(lines[1]).toBe("─────  ────────  ───");
    // Inter-column padding preserved; trailing whitespace per line trimmed
    expect(lines[2]).toBe("1      2         3");
    expect(lines[3]).toBe("xx     yy        zz");
  });

  it("col width grows to max(header, max(row[i]))", () => {
    const out = formatTable(["X", "Y"], [["abcdefg", "1"]], colors);
    const lines = out.split("\n");
    expect(lines[0]).toBe("X        Y");
    expect(lines[1]).toBe("───────  ─");
    expect(lines[2]).toBe("abcdefg  1");
  });

  it("workspace list sample matches expected layout", () => {
    const out = formatTable(
      ["TEAM_ID", "NAME", "DEFAULT_CHANNEL", "TOKENS_STORE", "TOKEN"],
      [["T9Q9BSR6C", "Toranomon", "(none)", "keychain", "xoxp-***001b"]],
      colors,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("TEAM_ID    NAME       DEFAULT_CHANNEL  TOKENS_STORE  TOKEN");
    expect(lines[1]).toBe("─────────  ─────────  ───────────────  ────────────  ────────────");
    expect(lines[2]).toBe("T9Q9BSR6C  Toranomon  (none)           keychain      xoxp-***001b");
  });
});
