import { describe, expect, it } from "bun:test";
import { JsonlFormatter } from "../../src/output/jsonl.ts";
import { ToonFormatter } from "../../src/output/toon.ts";

describe("ToonFormatter (stub: delegates to JSONL)", () => {
  it("byte-equal with JsonlFormatter for several inputs", () => {
    const t = new ToonFormatter();
    const j = new JsonlFormatter();
    const samples: unknown[] = [
      { a: 1 },
      { ts: "1", text: "hello", user: "U1" },
      [1, 2, 3],
      "primitive",
      42,
      null,
    ];
    for (const s of samples) {
      expect(t.format(s)).toBe(j.format(s));
    }
  });
});
