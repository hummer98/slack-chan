import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { makeColors } from "../../src/output/ansi.ts";
import { HumanFormatter } from "../../src/output/human.ts";

const ESC = String.fromCharCode(0x1b);

function hasAnsi(s: string): boolean {
  return s.includes(`${ESC}[`);
}

describe("HumanFormatter color suppression", () => {
  let savedNoColor: string | undefined;
  let savedSlackNoColor: string | undefined;

  beforeEach(() => {
    savedNoColor = process.env.NO_COLOR;
    savedSlackNoColor = process.env.SLACK_CHAN_NO_COLOR;
  });

  afterEach(() => {
    if (savedNoColor === undefined) delete process.env.NO_COLOR;
    else process.env.NO_COLOR = savedNoColor;
    if (savedSlackNoColor === undefined) delete process.env.SLACK_CHAN_NO_COLOR;
    else process.env.SLACK_CHAN_NO_COLOR = savedSlackNoColor;
  });

  it("non-TTY (colors=off) → no ANSI escapes", () => {
    const f = new HumanFormatter({ colors: makeColors(false) });
    const out = f.format({ a: 1 });
    expect(hasAnsi(out)).toBe(false);
    expect(out).toContain('"a": 1');
    expect(out.endsWith("\n")).toBe(true);
  });

  it("TTY (colors=on) → contains ANSI escapes", () => {
    const f = new HumanFormatter({ colors: makeColors(true) });
    const out = f.format({ a: 1 });
    expect(hasAnsi(out)).toBe(true);
  });

  it("NO_COLOR env suppresses color via isColorEnabled (default ctor)", () => {
    process.env.NO_COLOR = "1";
    delete process.env.SLACK_CHAN_NO_COLOR;
    const f = new HumanFormatter();
    const out = f.format({ a: 1 });
    expect(hasAnsi(out)).toBe(false);
  });
});
