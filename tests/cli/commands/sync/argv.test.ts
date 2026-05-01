import { describe, expect, it } from "bun:test";
import { parseSyncArgv } from "../../../../src/cli/commands/sync/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("parseSyncArgv", () => {
  it("positional 1 個 + flag 無し → full=false", () => {
    const a = parseSyncArgv(["#general"]);
    expect(a.channel).toBe("#general");
    expect(a.full).toBe(false);
  });

  it("--full で full=true", () => {
    const a = parseSyncArgv(["C12345678", "--full"]);
    expect(a.channel).toBe("C12345678");
    expect(a.full).toBe(true);
  });

  it("positional 0 個 → UserError", () => {
    try {
      parseSyncArgv([]);
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("<channel> is required");
    }
  });

  it("positional 2 個 → UserError", () => {
    try {
      parseSyncArgv(["a", "b"]);
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("too many arguments");
    }
  });

  it("未知フラグ → UserError", () => {
    try {
      parseSyncArgv(["a", "--limit=10"]);
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
    }
  });
});
