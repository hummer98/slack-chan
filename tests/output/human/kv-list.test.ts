import { describe, expect, it } from "bun:test";
import { makeColors } from "../../../src/output/ansi.ts";
import { formatKvList } from "../../../src/output/human/kv-list.ts";

const colors = makeColors(false);

describe("formatKvList", () => {
  it("empty input → empty string", () => {
    expect(formatKvList([], colors)).toBe("");
  });

  it("single entry has no padding (label width = 0)", () => {
    const out = formatKvList([{ label: "Foo", value: "bar" }], colors);
    expect(out).toBe("  Foo : bar\n");
  });

  it("multiple entries align labels by max width", () => {
    const out = formatKvList(
      [
        { label: "Channels", value: "1 (member: 0)" },
        { label: "Messages", value: "40 (alive: 40)" },
        { label: "Users", value: "193" },
        { label: "DB size", value: "671.7 KiB" },
      ],
      colors,
    );
    const lines = out.split("\n");
    expect(lines[0]).toBe("  Channels : 1 (member: 0)");
    expect(lines[1]).toBe("  Messages : 40 (alive: 40)");
    expect(lines[2]).toBe("  Users    : 193");
    expect(lines[3]).toBe("  DB size  : 671.7 KiB");
    expect(lines[4]).toBe("");
  });

  it("indent option overrides default", () => {
    const out = formatKvList([{ label: "x", value: "y" }], colors, { indent: 0 });
    expect(out).toBe("x : y\n");
  });

  it("emphasize wraps the label with bold when colors=on", () => {
    const c = makeColors(true);
    const out = formatKvList([{ label: "Foo", value: "bar", emphasize: true }], c);
    expect(out).toContain("Foo");
    const ESC = String.fromCharCode(0x1b);
    expect(out).toContain(`${ESC}[1m`);
  });
});
