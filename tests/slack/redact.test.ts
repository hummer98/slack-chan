import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { StderrLogger } from "../../src/slack/logger.ts";
import { redactSecrets, SLACK_TOKEN_PATTERN } from "../../src/slack/redact.ts";

describe("redactSecrets", () => {
  it("(A) masks xoxb-/xoxp- tokens inside string primitives", () => {
    const out = redactSecrets("hello xoxb-1234-5678-abcdefghij");
    expect(typeof out).toBe("string");
    expect(out).not.toContain("xoxb-1234-5678-abcdefghij");
    expect(out as string).toMatch(/xoxb-\*\*\*/);

    const out2 = redactSecrets("auth: xoxp-1234-5678-abcdefghij");
    expect(out2).not.toContain("xoxp-1234-5678-abcdefghij");
    expect(out2 as string).toMatch(/xoxp-\*\*\*/);
  });

  it("(B) recursively masks values in nested objects and arrays", () => {
    const input = {
      token: "xoxp-1234-5678-abcdefghij",
      kept: "regular value",
      nested: {
        body: "ok",
        arr: ["xoxb-1111-2222-zzzzzzzz", "no token"],
      },
    };
    const out = redactSecrets(input) as {
      token: string;
      kept: string;
      nested: { body: string; arr: string[] };
    };
    expect(out.token).not.toContain("xoxp-1234-5678-abcdefghij");
    expect(out.token).toMatch(/xoxp-\*\*\*/);
    expect(out.kept).toBe("regular value");
    expect(out.nested.body).toBe("ok");
    expect(out.nested.arr[0]).not.toContain("xoxb-1111-2222-zzzzzzzz");
    expect(out.nested.arr[0]).toMatch(/xoxb-\*\*\*/);
    expect(out.nested.arr[1]).toBe("no token");
    expect(input.token).toBe("xoxp-1234-5678-abcdefghij");
  });

  it("(C) masks Error.message and Error.stack without mutating the source", () => {
    const err = new Error("auth failed: xoxb-1234-5678-abcdefghij");
    const out = redactSecrets(err) as {
      name: string;
      message: string;
      stack?: string;
    };
    expect(out.name).toBe("Error");
    expect(out.message).not.toContain("xoxb-1234-5678-abcdefghij");
    expect(out.message).toMatch(/xoxb-\*\*\*/);
    if (typeof out.stack === "string") {
      expect(out.stack).not.toContain("xoxb-1234-5678-abcdefghij");
    }
    expect(err.message).toBe("auth failed: xoxb-1234-5678-abcdefghij");
  });

  it("(C2) recursively redacts Error.cause", () => {
    const cause = new Error("inner: xoxp-aaaa-bbbb-ccccdddd");
    const err = new Error("outer", { cause });
    const out = redactSecrets(err) as { cause?: { message: string } };
    expect(out.cause).toBeDefined();
    expect(out.cause?.message).not.toContain("xoxp-aaaa-bbbb-ccccdddd");
  });

  it("(D) returns primitives untouched", () => {
    expect(redactSecrets(42)).toBe(42);
    expect(redactSecrets(undefined)).toBeUndefined();
    expect(redactSecrets(null)).toBeNull();
    expect(redactSecrets(true)).toBe(true);
    expect(redactSecrets("no token here")).toBe("no token here");
  });

  it("(E) returns null when depth limit is exhausted", () => {
    const out = redactSecrets({ a: "x" }, 0);
    expect(out).toBeNull();
  });

  it("(F) does NOT mask xoxa- tokens (xoxa- is excluded)", () => {
    const input = "legacy xoxa-1234-5678-abcdefghij here";
    const out = redactSecrets(input);
    expect(out).toBe(input);
  });

  it("SLACK_TOKEN_PATTERN matches only xoxb-/xoxp-", () => {
    SLACK_TOKEN_PATTERN.lastIndex = 0;
    expect(SLACK_TOKEN_PATTERN.test("xoxb-abcd-1234-zzzz")).toBe(true);
    SLACK_TOKEN_PATTERN.lastIndex = 0;
    expect(SLACK_TOKEN_PATTERN.test("xoxp-abcd-1234-zzzz")).toBe(true);
    SLACK_TOKEN_PATTERN.lastIndex = 0;
    expect(SLACK_TOKEN_PATTERN.test("xoxa-abcd-1234-zzzz")).toBe(false);
  });
});

describe("StderrLogger redact integration", () => {
  let writeSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(() => {
    writeSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mock.restore();
    writeSpy = null;
  });

  function captured(): string {
    if (!writeSpy) return "";
    return writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
  }

  it("(A) redacts string primitive arguments", () => {
    const logger = new StderrLogger();
    logger.error("auth failed for token=xoxb-1234-5678-abcdefghij");
    const out = captured();
    expect(out).not.toContain("xoxb-1234-5678-abcdefghij");
    expect(out).toMatch(/xoxb-\*\*\*/);
    expect(out).toContain("[slack-chan]");
    expect(out).toContain("error");
  });

  it("(B) redacts object arguments and supports multiple args", () => {
    const logger = new StderrLogger();
    logger.warn("hello", { token: "xoxb-aaaa-bbbb-ccccdddd" });
    const out = captured();
    expect(out).not.toContain("xoxb-aaaa-bbbb-ccccdddd");
    expect(out).toContain("hello");
    expect(out).toContain("warn");
  });

  it("(C) redacts Error message and stack", () => {
    const logger = new StderrLogger();
    logger.error(new Error("boom: xoxb-1234-5678-abcdefghij"));
    const out = captured();
    expect(out).not.toContain("xoxb-1234-5678-abcdefghij");
    expect(out).toMatch(/xoxb-\*\*\*/);
  });
});

describe("StderrLogger SLACK_CHAN_DEBUG parsing", () => {
  let writeSpy: ReturnType<typeof spyOn> | null = null;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.SLACK_CHAN_DEBUG;
    writeSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    if (savedEnv === undefined) {
      delete process.env.SLACK_CHAN_DEBUG;
    } else {
      process.env.SLACK_CHAN_DEBUG = savedEnv;
    }
    mock.restore();
    writeSpy = null;
  });

  function captured(): string {
    if (!writeSpy) return "";
    return writeSpy.mock.calls.map((c: unknown[]) => String(c[0])).join("");
  }

  it('(D-1) emits debug when SLACK_CHAN_DEBUG="1"', () => {
    process.env.SLACK_CHAN_DEBUG = "1";
    const logger = new StderrLogger();
    logger.debug("dbg-1-marker");
    expect(captured()).toContain("dbg-1-marker");
  });

  it('(D-2) emits debug when SLACK_CHAN_DEBUG="true"', () => {
    process.env.SLACK_CHAN_DEBUG = "true";
    const logger = new StderrLogger();
    logger.debug("dbg-true-marker");
    expect(captured()).toContain("dbg-true-marker");
  });

  it("(D-3) does NOT emit debug when SLACK_CHAN_DEBUG is unset", () => {
    delete process.env.SLACK_CHAN_DEBUG;
    const logger = new StderrLogger();
    logger.debug("dbg-unset-marker");
    expect(captured()).not.toContain("dbg-unset-marker");
  });

  it('(D-4) does NOT emit debug when SLACK_CHAN_DEBUG=""', () => {
    process.env.SLACK_CHAN_DEBUG = "";
    const logger = new StderrLogger();
    logger.debug("dbg-empty-marker");
    expect(captured()).not.toContain("dbg-empty-marker");
  });
});
