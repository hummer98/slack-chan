import { describe, expect, it } from "bun:test";
import { parsePostArgv } from "../../../../src/cli/commands/post/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("parsePostArgv", () => {
  // ---------- 正常系 ----------

  it("(1) <channel> <text> のみ", () => {
    const r = parsePostArgv(["C0123ABCDEF", "hello"]);
    expect(r.channel).toBe("C0123ABCDEF");
    expect(r.text).toBe("hello");
    expect(r.thread).toBeUndefined();
    expect(r.file).toBeUndefined();
    expect(r.blocks).toBeUndefined();
  });

  it("(2) --thread=1234567890.123456 付き", () => {
    const r = parsePostArgv(["C0123ABCDEF", "hi", "--thread=1234567890.123456"]);
    expect(r.thread).toBe("1234567890.123456");
  });

  it("(3) --file=/tmp/x.png 付き", () => {
    const r = parsePostArgv(["C0123ABCDEF", "hi", "--file=/tmp/x.png"]);
    expect(r.file).toBe("/tmp/x.png");
  });

  it("(4) --blocks 付き (インライン JSON)", () => {
    const r = parsePostArgv(["C0123ABCDEF", "hi", '--blocks=[{"type":"section"}]']);
    expect(r.blocks).toBe('[{"type":"section"}]');
  });

  it("(5) --blocks=./blocks.json 付き", () => {
    const r = parsePostArgv(["C0123ABCDEF", "hi", "--blocks=./blocks.json"]);
    expect(r.blocks).toBe("./blocks.json");
  });

  it("(6) channel name (#general や general) も受理する", () => {
    expect(parsePostArgv(["#general", "hi"]).channel).toBe("#general");
    expect(parsePostArgv(["general", "hi"]).channel).toBe("general");
  });

  // ---------- 異常系 ----------

  it("(7) positional 0 件 → missing <channel>", () => {
    expect(() => parsePostArgv([])).toThrow(UserError);
    try {
      parsePostArgv([]);
    } catch (e) {
      expect((e as UserError).message).toContain("missing <channel>");
    }
  });

  it("(8) positional 1 件 → missing <text>", () => {
    try {
      parsePostArgv(["C0123ABCDEF"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("missing <text>");
    }
  });

  it("(9) positional 3 件以上 → too many arguments", () => {
    try {
      parsePostArgv(["C0123ABCDEF", "hi", "extra"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("too many arguments");
    }
  });

  it("(10) --thread=invalid → must match Slack ts format", () => {
    try {
      parsePostArgv(["C0123ABCDEF", "hi", "--thread=invalid"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("Slack ts format");
    }
  });

  it("(11) --unknown=foo → UserError (strict)", () => {
    expect(() => parsePostArgv(["C0123ABCDEF", "hi", "--unknown=foo"])).toThrow(UserError);
  });

  it("(12) --blocks + --file 併用 → mutually exclusive", () => {
    try {
      parsePostArgv(["C0123ABCDEF", "hi", "--blocks=[]", "--file=/tmp/x"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("mutually exclusive");
    }
  });

  it("(13) text 空文字 → must be a non-empty string", () => {
    try {
      parsePostArgv(["C0123ABCDEF", ""]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("non-empty");
    }
  });

  it("(14) text 制御文字 (\\n, \\t 以外) → UserError", () => {
    try {
      parsePostArgv(["C0123ABCDEF", `hello${String.fromCharCode(0x01)}world`]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("control characters");
    }
    // \n / \t は通る
    expect(() => parsePostArgv(["C0123ABCDEF", "line1\nline2\twith tab"])).not.toThrow();
  });

  it("(15) channel 空文字 → UserError", () => {
    try {
      parsePostArgv(["", "hi"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("non-empty");
    }
  });

  it("(16) channel 形式違反 (@user) → UserError", () => {
    try {
      parsePostArgv(["@user", "hi"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not a valid channel id");
    }
  });
});
