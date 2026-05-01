import { describe, expect, it } from "bun:test";
import { parseDownloadArgv } from "../../../../src/cli/commands/download/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("parseDownloadArgv", () => {
  // ---------- 正常系 ----------

  it("(1) <ts> のみ", () => {
    const r = parseDownloadArgv(["1700000000.001000"]);
    expect(r.ts).toBe("1700000000.001000");
    expect(r.channel).toBeUndefined();
    expect(r.out).toBeUndefined();
    expect(r.force).toBe(false);
  });

  it("(2) --channel=Cxxx ok", () => {
    const r = parseDownloadArgv(["1700000000.001000", "--channel=C0123ABCDEF"]);
    expect(r.channel).toBe("C0123ABCDEF");
  });

  it("(3) --channel=#general → そのまま (handler で正規化)", () => {
    const r = parseDownloadArgv(["1700000000.001000", "--channel=#general"]);
    expect(r.channel).toBe("#general");
  });

  it("(4) --out=/tmp/x ok", () => {
    const r = parseDownloadArgv(["1700000000.001000", "--out=/tmp/x"]);
    expect(r.out).toBe("/tmp/x");
  });

  it("(5) --force → boolean true", () => {
    const r = parseDownloadArgv(["1700000000.001000", "--force"]);
    expect(r.force).toBe(true);
  });

  it("(5b) --force 未指定 → false (I-2 正規化)", () => {
    const r = parseDownloadArgv(["1700000000.001000"]);
    expect(r.force).toBe(false);
  });

  it("(6) channel name (#なし) も受理", () => {
    const r = parseDownloadArgv(["1700000000.001000", "--channel=general"]);
    expect(r.channel).toBe("general");
  });

  // ---------- 異常系 ----------

  it("(7) positional 0 件 → missing <ts>", () => {
    try {
      parseDownloadArgv([]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("missing <ts>");
    }
  });

  it("(8) positional 2 件 → too many arguments", () => {
    try {
      parseDownloadArgv(["1700000000.001000", "extra"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("too many arguments");
    }
  });

  it("(9) ts 不正 (abc) → Slack ts format", () => {
    try {
      parseDownloadArgv(["abc"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("Slack ts format");
    }
  });

  it("(10) ts 制御文字 → control characters", () => {
    try {
      parseDownloadArgv([`1700000000.001000${String.fromCharCode(0x01)}`]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("control characters");
    }
  });

  it("(11) --channel=@user → not a valid channel id", () => {
    try {
      parseDownloadArgv(["1700000000.001000", "--channel=@user"]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not a valid channel id");
    }
  });

  it("(12) --channel= 空 → non-empty", () => {
    try {
      parseDownloadArgv(["1700000000.001000", "--channel="]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("non-empty");
    }
  });

  it("(13) --out= 空 → non-empty", () => {
    try {
      parseDownloadArgv(["1700000000.001000", "--out="]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("non-empty");
    }
  });

  it("(14) --out 制御文字 → control characters", () => {
    try {
      parseDownloadArgv(["1700000000.001000", `--out=/tmp/${String.fromCharCode(0x01)}x`]);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("control characters");
    }
  });

  it("(15) --unknown=foo → strict reject", () => {
    expect(() => parseDownloadArgv(["1700000000.001000", "--unknown=foo"])).toThrow(UserError);
  });

  it("(16) ts に '--' 後置: parseArgs はそれを positional として扱う", () => {
    // ["--", "1700000000.001000"] のように `--` を先置すると、後続の positional が
    // option ではなく値として扱われる挙動 (parseArgs の標準仕様)。
    const r = parseDownloadArgv(["--", "1700000000.001000"]);
    expect(r.ts).toBe("1700000000.001000");
  });
});
