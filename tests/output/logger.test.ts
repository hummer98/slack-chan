import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { StderrLogger } from "../../src/output/logger.ts";

describe("StderrLogger setLevel", () => {
  let writeSpy: ReturnType<typeof spyOn> | null = null;
  let savedEnv: string | undefined;

  beforeEach(() => {
    savedEnv = process.env.SLACK_CHAN_DEBUG;
    delete process.env.SLACK_CHAN_DEBUG;
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

  it('emits debug after setLevel("debug")', () => {
    const logger = new StderrLogger();
    logger.setLevel("debug");
    logger.debug("dbg-marker");
    expect(captured()).toContain("dbg-marker");
  });

  it('does not emit info when setLevel("error")', () => {
    const logger = new StderrLogger();
    logger.setLevel("error");
    logger.info("info-marker");
    expect(captured()).not.toContain("info-marker");
    logger.error("err-marker");
    expect(captured()).toContain("err-marker");
  });

  it("default level is info: debug suppressed, info shown", () => {
    const logger = new StderrLogger();
    logger.debug("dbg-default");
    expect(captured()).not.toContain("dbg-default");
    logger.info("info-default");
    expect(captured()).toContain("info-default");
  });

  it("redacts xoxb-/xoxp- tokens from stderr output", () => {
    const logger = new StderrLogger();
    logger.error("token leaked: xoxb-1234-5678-abcdefghij");
    const out = captured();
    expect(out).not.toContain("xoxb-1234-5678-abcdefghij");
    expect(out).toMatch(/xoxb-\*\*\*/);
  });
});
