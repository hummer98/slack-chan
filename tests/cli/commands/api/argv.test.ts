import { describe, expect, it } from "bun:test";
import { parseApiArgv } from "../../../../src/cli/commands/api/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("parseApiArgv", () => {
  it("(1) method only → rawParams empty", () => {
    const args = parseApiArgv(["conversations.info"]);
    expect(args.method).toBe("conversations.info");
    expect(args.rawParams).toEqual([]);
  });

  it("(2) method + 1 param", () => {
    const args = parseApiArgv(["conversations.info", "channel=C0123"]);
    expect(args.method).toBe("conversations.info");
    expect(args.rawParams).toEqual(["channel=C0123"]);
  });

  it("(3) method + multiple params", () => {
    const args = parseApiArgv(["chat.postMessage", "text=hi", "channel:=null"]);
    expect(args.method).toBe("chat.postMessage");
    expect(args.rawParams).toEqual(["text=hi", "channel:=null"]);
  });

  it("(4) no method → UserError missing <method>", () => {
    try {
      parseApiArgv([]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("missing <method>");
    }
  });

  it("(5) method starts with uppercase → UserError 'is not a valid'", () => {
    try {
      parseApiArgv(["Conversations.history"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("is not a valid");
    }
  });

  it("(6) method with consecutive dots → UserError", () => {
    try {
      parseApiArgv(["conversations..info"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("is not a valid");
    }
  });

  it("(7) method with trailing dot → UserError", () => {
    try {
      parseApiArgv(["conversations."]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("is not a valid");
    }
  });

  it("(8) unknown flag --foo → UserError (parseArgs strict)", () => {
    try {
      parseApiArgv(["conversations.info", "--unknown=x"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
    }
  });

  it("(9) auth.test (single segment after dot) is valid", () => {
    const args = parseApiArgv(["auth.test"]);
    expect(args.method).toBe("auth.test");
  });

  it("(10) bare method without dot is valid", () => {
    const args = parseApiArgv(["api"]);
    expect(args.method).toBe("api");
  });

  it("(11) chat.postMessage (camelCase second segment) is valid", () => {
    const args = parseApiArgv(["chat.postMessage"]);
    expect(args.method).toBe("chat.postMessage");
  });
});
