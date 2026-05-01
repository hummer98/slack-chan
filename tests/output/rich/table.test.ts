import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import { formatRichTable } from "../../../src/output/rich/table.ts";

const colors = makeColors(false);

describe("formatRichTable", () => {
  it("empty rows: header + separator only", () => {
    const out = formatRichTable(["A", "B"], [], colors);
    const lines = out.split("\n");
    expect(lines[0]).toBe("A  B");
    expect(lines[1]).toBe("─  ─");
    expect(lines[2]).toBe("");
  });

  it("workspace list sample (no colors) matches human/table layout exactly", () => {
    const out = formatRichTable(
      ["TEAM_ID", "NAME", "DEFAULT_CHANNEL", "TOKENS_STORE", "TOKEN"],
      [["T9Q9BSR6C", "Toranomon", "(none)", "keychain", "xoxp-***001b"]],
      colors,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("TEAM_ID    NAME       DEFAULT_CHANNEL  TOKENS_STORE  TOKEN");
    expect(lines[1]).toBe("─────────  ─────────  ───────────────  ────────────  ────────────");
    expect(lines[2]).toBe("T9Q9BSR6C  Toranomon  (none)           keychain      xoxp-***001b");
  });

  it("colors=on: header row contains bold + cyan, separator dimmed", () => {
    const c = makeColors(true);
    const out = formatRichTable(["X", "Y"], [["a", "b"]], c);
    const ESC = String.fromCharCode(0x1b);
    const headerLine = out.split("\n")[0] ?? "";
    const sepLine = out.split("\n")[1] ?? "";
    expect(headerLine).toContain(`${ESC}[1m`); // bold
    expect(headerLine).toContain(`${ESC}[36m`); // cyan
    expect(sepLine).toContain(`${ESC}[2m`); // dim
  });
});
