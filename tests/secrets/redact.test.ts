import { describe, expect, it } from "bun:test";
import { REDACT_KEEP_TAIL, redactToken } from "../../src/secrets/redact.ts";

describe("redactToken", () => {
  it("exposes REDACT_KEEP_TAIL = 4 (so test edits stay in one place)", () => {
    expect(REDACT_KEEP_TAIL).toBe(4);
  });

  it("masks the middle of an xoxp- token, keeping prefix + tail 4", () => {
    const raw = "xoxp-1234567890-1234567890-abcdefghij";
    const out = redactToken(raw);
    expect(out).toBe("xoxp-***ghij");
    expect(out).not.toContain("567890"); // raw segments must not leak
    expect(out).not.toContain("abcdef");
  });

  it("masks the middle of an xoxb- token, keeping prefix + tail 4", () => {
    const raw = "xoxb-1234567890-abcdefghijklm";
    const out = redactToken(raw);
    expect(out).toBe("xoxb-***jklm");
    expect(out).not.toContain("abcdefghi");
  });

  it("returns *** for empty string", () => {
    expect(redactToken("")).toBe("***");
  });

  it("returns *** for non-xoxp / non-xoxb prefix", () => {
    expect(redactToken("xoxc-stolen-token")).toBe("***");
    expect(redactToken("xoxd-stolen-token")).toBe("***");
    expect(redactToken("not-a-token")).toBe("***");
  });

  it("returns *** for tokens too short to safely keep a tail", () => {
    // shorter than prefix + REDACT_KEEP_TAIL chars → full mask
    expect(redactToken("xoxp-1")).toBe("***");
    expect(redactToken("xoxp-")).toBe("***");
  });

  it("does not throw for null / undefined / non-string input (logger safety)", () => {
    // intentional bad inputs through the unknown channel
    const f = redactToken as unknown as (x: unknown) => string;
    expect(f(undefined)).toBe("***");
    expect(f(null)).toBe("***");
    expect(f(123)).toBe("***");
    expect(f({})).toBe("***");
  });

  it("never leaks raw token characters past the kept tail", () => {
    const raw = "xoxp-supersecretmiddle-abcdefghij";
    const out = redactToken(raw);
    expect(out).toBe("xoxp-***ghij");
    // No middle segment characters should appear in the redacted output.
    expect(out.includes("supersecret")).toBe(false);
    expect(out.includes("middle")).toBe(false);
  });
});
