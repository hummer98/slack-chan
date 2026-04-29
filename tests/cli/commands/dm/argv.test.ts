import { describe, expect, it } from "bun:test";
import { classifyUser, parseDmArgv } from "../../../../src/cli/commands/dm/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("classifyUser", () => {
  it("Uxxx → id", () => {
    expect(classifyUser("U0123ABCDEF")).toBe("id");
  });

  it("Wxxx (Enterprise Grid) → id", () => {
    expect(classifyUser("W0123ABCDEF")).toBe("id");
  });

  it("@name → name", () => {
    expect(classifyUser("@alice")).toBe("name");
  });

  it("email → email", () => {
    expect(classifyUser("alice@example.com")).toBe("email");
  });

  it("空文字 → UserError", () => {
    expect(() => classifyUser("")).toThrow(UserError);
  });

  it("@ 単独 → UserError", () => {
    expect(() => classifyUser("@")).toThrow(UserError);
  });

  it("意味不明な文字列 → UserError", () => {
    expect(() => classifyUser("notavalid")).toThrow(UserError);
  });

  it("制御文字含み → UserError", () => {
    expect(() => classifyUser(`a${String.fromCharCode(0x01)}b@example.com`)).toThrow(UserError);
  });
});

describe("parseDmArgv (post)", () => {
  it("(1) <user> <text> のみ", () => {
    const r = parseDmArgv(["U0123ABCDEF", "hi"]);
    expect(r.mode).toBe("post");
    if (r.mode !== "post") throw new Error("expected post mode");
    expect(r.user).toBe("U0123ABCDEF");
    expect(r.userKind).toBe("id");
    expect(r.text).toBe("hi");
  });

  it("(2) email + text", () => {
    const r = parseDmArgv(["alice@example.com", "hi"]);
    expect(r.mode).toBe("post");
    if (r.mode !== "post") throw new Error();
    expect(r.userKind).toBe("email");
  });

  it("(3) @name + text", () => {
    const r = parseDmArgv(["@alice", "hi"]);
    if (r.mode !== "post") throw new Error();
    expect(r.userKind).toBe("name");
  });

  it("(4) --thread / --file / --blocks 受理", () => {
    const r = parseDmArgv(["U0123ABCDEF", "hi", "--thread=1700000000.000100", "--file=/tmp/x.png"]);
    if (r.mode !== "post") throw new Error();
    expect(r.thread).toBe("1700000000.000100");
    expect(r.file).toBe("/tmp/x.png");
  });

  it("(5) <text> 不在 → UserError missing <text>", () => {
    try {
      parseDmArgv(["U0123ABCDEF"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("missing <text>");
    }
  });

  it("(6) too many positionals", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "hi", "extra"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("too many arguments");
    }
  });

  it("(7) write mode で --limit → UserError", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "hi", "--limit=10"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("only valid with --read");
    }
  });

  it("(8) write mode で --refresh → UserError", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "hi", "--refresh"]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
    }
  });

  it("(9) --blocks + --file 併用 → mutually exclusive", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "hi", "--blocks=[]", "--file=/tmp/x"]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("mutually exclusive");
    }
  });

  it("(10) --thread フォーマット違反 → UserError", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "hi", "--thread=invalid"]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("Slack ts format");
    }
  });

  it("(11) <text> 空 → UserError", () => {
    try {
      parseDmArgv(["U0123ABCDEF", ""]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("non-empty");
    }
  });
});

describe("parseDmArgv (read)", () => {
  it("(1) --read のみ", () => {
    const r = parseDmArgv(["U0123ABCDEF", "--read"]);
    expect(r.mode).toBe("read");
    if (r.mode !== "read") throw new Error();
    expect(r.user).toBe("U0123ABCDEF");
    expect(r.refresh).toBe(false);
    expect(r.fullEditScan).toBe(false);
  });

  it("(2) --read --limit --since --thread --refresh --full-edit-scan 受理", () => {
    const r = parseDmArgv([
      "U0123ABCDEF",
      "--read",
      "--limit=10",
      "--since=1d",
      "--thread=1700000000.000100",
      "--refresh",
      "--full-edit-scan",
    ]);
    if (r.mode !== "read") throw new Error();
    expect(r.limit).toBe("10");
    expect(r.since).toBe("1d");
    expect(r.thread).toBe("1700000000.000100");
    expect(r.refresh).toBe(true);
    expect(r.fullEditScan).toBe(true);
  });

  it("(3) --read + 余分 positional → UserError", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "extra", "--read"]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("too many positional arguments for --read");
    }
  });

  it("(4) --read + --file → UserError", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "--read", "--file=/x"]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("--file / --blocks cannot be combined");
    }
  });

  it("(5) --read + --blocks → UserError", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "--read", "--blocks=[]"]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
    }
  });

  it("(6) --read で --thread フォーマット違反 → UserError", () => {
    try {
      parseDmArgv(["U0123ABCDEF", "--read", "--thread=invalid"]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("Slack ts");
    }
  });
});

describe("parseDmArgv エラー", () => {
  it("引数なし → missing <user>", () => {
    try {
      parseDmArgv([]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("missing <user>");
    }
  });

  it("--unknown=foo → strict UserError", () => {
    expect(() => parseDmArgv(["U0123ABCDEF", "hi", "--unknown=foo"])).toThrow(UserError);
  });

  it("<user> 形式違反 → UserError", () => {
    try {
      parseDmArgv(["badformat", "hi"]);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not a valid");
    }
  });
});
