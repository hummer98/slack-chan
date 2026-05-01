import { describe, expect, it } from "bun:test";
import { makeColors } from "../../src/output/ansi.ts";

const ESC = String.fromCharCode(0x1b);

describe("makeColors(true) returns wrapping helpers", () => {
  const c = makeColors(true);

  it("red wraps with 31m..39m", () => {
    expect(c.red("hi")).toBe(`${ESC}[31mhi${ESC}[39m`);
  });

  it("yellow / green / cyan / magenta", () => {
    expect(c.yellow("x")).toContain("33m");
    expect(c.green("x")).toContain("32m");
    expect(c.cyan("x")).toContain("36m");
    expect(c.magenta("x")).toContain("35m");
  });

  it("dim / bold", () => {
    expect(c.dim("x")).toContain("2m");
    expect(c.bold("x")).toContain("1m");
  });

  it("yellowBg wraps with 43m..49m", () => {
    expect(c.yellowBg("hi")).toBe(`${ESC}[43mhi${ESC}[49m`);
  });
});

describe("makeColors(false) is identity", () => {
  const c = makeColors(false);

  it("never adds escapes", () => {
    expect(c.red("hi")).toBe("hi");
    expect(c.yellowBg("hi")).toBe("hi");
    expect(c.bold("hi")).toBe("hi");
    expect(c.dim("hi")).toBe("hi");
  });
});
