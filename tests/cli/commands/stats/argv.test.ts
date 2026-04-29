import { describe, expect, it } from "bun:test";
import { parseStatsArgv } from "../../../../src/cli/commands/stats/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("parseStatsArgv", () => {
  it("引数 0 個でパース成功", () => {
    expect(parseStatsArgv([])).toEqual({});
  });

  it("positional が 1 個でも UserError", () => {
    try {
      parseStatsArgv(["foo"]);
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("unexpected argument");
    }
  });

  it("未知フラグで UserError", () => {
    try {
      parseStatsArgv(["--bogus"]);
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
    }
  });
});
