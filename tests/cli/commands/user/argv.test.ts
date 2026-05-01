import { describe, expect, it } from "bun:test";
import { parseUserArgv, USAGE } from "../../../../src/cli/commands/user/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("parseUserArgv", () => {
  // ---------- 正常系 ----------

  it("(1) id 形式", () => {
    expect(parseUserArgv(["U01ABCDEF"])).toEqual({ identifier: "U01ABCDEF" });
  });

  it("(2) email 形式", () => {
    expect(parseUserArgv(["alice@example.com"])).toEqual({ identifier: "alice@example.com" });
  });

  it("(3) @name 形式 (先頭 @ を argv 段階では strip しない)", () => {
    expect(parseUserArgv(["@yamamoto"])).toEqual({ identifier: "@yamamoto" });
  });

  it("(4) name 形式 (@ なし) も argv は通す", () => {
    expect(parseUserArgv(["yamamoto"])).toEqual({ identifier: "yamamoto" });
  });

  // ---------- 異常系 ----------

  it("(5) positional 0 件 → missing <identifier>", () => {
    try {
      parseUserArgv([]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("missing <identifier>");
      expect((e as UserError).message).toContain(USAGE);
    }
  });

  it("(6) positional 2 件以上 → too many arguments", () => {
    try {
      parseUserArgv(["a", "b"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("too many arguments");
      expect((e as UserError).message).toContain(USAGE);
    }
  });

  it("(7) 制御文字 (\\n, \\t 以外) → control characters", () => {
    try {
      parseUserArgv([`ab${String.fromCharCode(0x01)}cd`]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("control characters");
    }
  });

  it("(8) 空白のみ → non-empty", () => {
    try {
      parseUserArgv(["   "]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("non-empty");
    }
  });

  it("(9) --unknown=foo → strict (UserError)", () => {
    expect(() => parseUserArgv(["U01ABCDEF", "--unknown=foo"])).toThrow(UserError);
  });
});
