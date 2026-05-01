import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { isEmojiEnabled, makeColors } from "../../src/output/ansi.ts";

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

describe("isEmojiEnabled", () => {
  const ORIG_NO_EMOJI = process.env.SLACK_CHAN_NO_EMOJI;

  beforeEach(() => {
    delete process.env.SLACK_CHAN_NO_EMOJI;
  });
  afterEach(() => {
    if (ORIG_NO_EMOJI === undefined) delete process.env.SLACK_CHAN_NO_EMOJI;
    else process.env.SLACK_CHAN_NO_EMOJI = ORIG_NO_EMOJI;
  });

  it("TTY stream → true", () => {
    expect(isEmojiEnabled({ isTTY: true })).toBe(true);
  });

  it("non-TTY stream → false", () => {
    expect(isEmojiEnabled({ isTTY: false })).toBe(false);
  });

  it("undefined isTTY → false", () => {
    expect(isEmojiEnabled({})).toBe(false);
  });

  it("SLACK_CHAN_NO_EMOJI set → false even on TTY", () => {
    process.env.SLACK_CHAN_NO_EMOJI = "1";
    expect(isEmojiEnabled({ isTTY: true })).toBe(false);
  });

  it("NO_COLOR alone does NOT disable emoji (independent control)", () => {
    process.env.NO_COLOR = "1";
    try {
      expect(isEmojiEnabled({ isTTY: true })).toBe(true);
    } finally {
      delete process.env.NO_COLOR;
    }
  });
});
