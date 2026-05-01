import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import { formatRichKvList } from "../../../src/output/rich/kv-list.ts";

const colors = makeColors(false);

describe("formatRichKvList", () => {
  it("empty input → empty string", () => {
    expect(formatRichKvList([], colors)).toBe("");
  });

  it("entries without glyphs render like human/kv-list (just bold label)", () => {
    const out = formatRichKvList(
      [
        { label: "Foo", value: "bar" },
        { label: "Bazzz", value: "qux" },
      ],
      colors,
    );
    expect(out).toBe("  Foo   : bar\n  Bazzz : qux\n");
  });

  it("entries with glyphs prepend ' <glyph> ' to each line", () => {
    const out = formatRichKvList(
      [
        { label: "Channels", value: "1", glyph: "💬" },
        { label: "Users", value: "193", glyph: "👥" },
      ],
      colors,
    );
    expect(out).toBe("  💬 Channels : 1\n  👥 Users    : 193\n");
  });

  it("mixed: missing glyph still aligns by reserving a space prefix slot", () => {
    const out = formatRichKvList(
      [
        { label: "A", value: "1", glyph: "💬" },
        { label: "B", value: "2" }, // no glyph
      ],
      colors,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("  💬 A : 1");
    // For column alignment with the glyph row, the glyph slot is replaced by
    // a single space. The label column itself is unaffected.
    expect(lines[1]).toBe("    B : 2");
  });

  it("indent option overrides default", () => {
    const out = formatRichKvList([{ label: "x", value: "y" }], colors, { indent: 0 });
    expect(out).toBe("x : y\n");
  });

  it("colors=on wraps label with bold", () => {
    const c = makeColors(true);
    const out = formatRichKvList([{ label: "Foo", value: "bar" }], c);
    const ESC = String.fromCharCode(0x1b);
    expect(out).toContain(`${ESC}[1m`);
    expect(out).toContain("Foo");
  });
});
