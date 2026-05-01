import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import { formatRichHeader } from "../../../src/output/rich/header.ts";

const colors = makeColors(false);

describe("formatRichHeader", () => {
  it("with glyph: 'glyph title'", () => {
    expect(formatRichHeader("Workspace", "📦", colors)).toBe("📦 Workspace");
  });

  it("empty glyph collapses prefix", () => {
    expect(formatRichHeader("Workspace", "", colors)).toBe("Workspace");
  });

  it("with colors=on wraps in bold + magenta", () => {
    const c = makeColors(true);
    const out = formatRichHeader("Hi", "📦", c);
    const ESC = String.fromCharCode(0x1b);
    expect(out).toContain(`${ESC}[1m`); // bold
    expect(out).toContain(`${ESC}[35m`); // magenta
    expect(out).toContain("📦 Hi");
  });
});
