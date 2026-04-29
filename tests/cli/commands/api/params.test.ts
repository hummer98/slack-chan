import { describe, expect, it } from "bun:test";
import { parseApiParams } from "../../../../src/cli/commands/api/params.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("parseApiParams", () => {
  it("(1) string value: k=v", () => {
    expect(parseApiParams(["channel=C0123"])).toEqual({ channel: "C0123" });
  });

  it("(2) JSON number: k:=50", () => {
    expect(parseApiParams(["limit:=50"])).toEqual({ limit: 50 });
  });

  it("(3) JSON boolean: k:=true", () => {
    expect(parseApiParams(["inclusive:=true"])).toEqual({ inclusive: true });
  });

  it("(4) JSON array", () => {
    expect(parseApiParams(['filter:=["a","b"]'])).toEqual({ filter: ["a", "b"] });
  });

  it("(5) JSON object", () => {
    expect(parseApiParams(['nested:={"a":1}'])).toEqual({ nested: { a: 1 } });
  });

  it("(6) value contains '=' → split at first '='", () => {
    expect(parseApiParams(["k=foo=bar"])).toEqual({ k: "foo=bar" });
  });

  it("(7) value contains ':=' but key uses '=' → string value", () => {
    expect(parseApiParams(["k=foo:=bar"])).toEqual({ k: "foo:=bar" });
  });

  it("(8) :=<bad json> → UserError 'not valid JSON'", () => {
    try {
      parseApiParams(["k:=bad"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not valid JSON");
    }
  });

  it("(9) token without '=' → UserError missing '='", () => {
    try {
      parseApiParams([""]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("missing '='");
    }
  });

  it("(10) empty key '=v' → UserError", () => {
    try {
      parseApiParams(["=v"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message.toLowerCase()).toContain("empty");
    }
  });

  it("(11) empty key ':=true' → UserError", () => {
    try {
      parseApiParams([":=true"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message.toLowerCase()).toContain("empty");
    }
  });

  it("(12) numeric leading key → UserError invalid parameter key", () => {
    try {
      parseApiParams(["1bad=v"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("invalid parameter key");
    }
  });

  it("(13) hyphen in key → UserError invalid parameter key", () => {
    try {
      parseApiParams(["bad-key=v"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("invalid parameter key");
    }
  });

  it("(14) duplicate key (=, =) → UserError 'specified more than once'", () => {
    try {
      parseApiParams(["k=a", "k=b"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("specified more than once");
    }
  });

  it("(15) duplicate key (=, :=) → UserError 'specified more than once'", () => {
    try {
      parseApiParams(["k=a", "k:=true"]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("specified more than once");
    }
  });

  it("(16) empty string value 'k=' → ok", () => {
    expect(parseApiParams(["k="])).toEqual({ k: "" });
  });

  it("(17) empty input → empty object", () => {
    expect(parseApiParams([])).toEqual({});
  });

  it("(18) ':=<empty>' → UserError 'not valid JSON'", () => {
    try {
      parseApiParams(["k:="]);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not valid JSON");
    }
  });

  it("(19) JSON null", () => {
    expect(parseApiParams(["channel:=null"])).toEqual({ channel: null });
  });

  it("(20) JSON string with quotes", () => {
    expect(parseApiParams(['name:="hello"'])).toEqual({ name: "hello" });
  });

  it("(21) underscore-prefixed and dotted keys are accepted", () => {
    expect(parseApiParams(["_k=v", "a.b=v2"])).toEqual({ _k: "v", "a.b": "v2" });
  });
});
