import { describe, expect, it } from "bun:test";
import type { Formatter } from "../../src/output/format.ts";
import { JsonlFormatter } from "../../src/output/jsonl.ts";

describe("JsonlFormatter", () => {
  it("(A) one record = one JSON line ending with \\n", () => {
    const f = new JsonlFormatter();
    expect(f.format({ a: 1 })).toBe('{"a":1}\n');
  });

  it("(B) formatBatch is intentionally not implemented (caller-side fallback)", () => {
    const f: Formatter = new JsonlFormatter();
    expect(f.formatBatch).toBeUndefined();
    const records = [{ a: 1 }, { b: 2 }];
    const joined = records.map((r) => f.format(r)).join("");
    expect(joined).toBe('{"a":1}\n{"b":2}\n');
  });

  it("(C) format(undefined) returns 'undefined\\n' (JSON.stringify undefined = undefined)", () => {
    const f = new JsonlFormatter();
    // JSON.stringify(undefined) === undefined → template returns 'undefined\n'.
    expect(f.format(undefined)).toBe("undefined\n");
  });

  it("(D) primitives are serialized via JSON.stringify", () => {
    const f = new JsonlFormatter();
    expect(f.format("hi")).toBe('"hi"\n');
    expect(f.format(42)).toBe("42\n");
    expect(f.format(null)).toBe("null\n");
    expect(f.format(true)).toBe("true\n");
  });
});
