import { describe, expect, it } from "bun:test";
import { parseConfigArgv } from "../../../../src/cli/commands/config/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

describe("parseConfigArgv", () => {
  const ctx = {
    command: "config workspace add",
    usage: "Usage: slack-chan config workspace add --token=<...>",
  };

  it("parses --key=value style options", () => {
    const r = parseConfigArgv<{ token?: string; name?: string }>(
      ["--token=xoxb-12345", "--name=Acme"],
      { token: { type: "string" }, name: { type: "string" } },
      ctx,
    );
    expect(r.values.token).toBe("xoxb-12345");
    expect(r.values.name).toBe("Acme");
  });

  it("parses --key value style options", () => {
    const r = parseConfigArgv<{ token?: string }>(
      ["--token", "xoxb-12345"],
      { token: { type: "string" } },
      ctx,
    );
    expect(r.values.token).toBe("xoxb-12345");
  });

  it("parses positionals", () => {
    const r = parseConfigArgv<{ yes?: boolean }>(
      ["T01ABC", "--yes"],
      { yes: { type: "boolean" } },
      ctx,
    );
    expect(r.positionals).toEqual(["T01ABC"]);
    expect(r.values.yes).toBe(true);
  });

  it("throws UserError for unknown options (strict mode)", () => {
    expect(() =>
      parseConfigArgv(["--unknown-flag=foo"], { token: { type: "string" } }, ctx),
    ).toThrow(UserError);
  });

  it("error message includes command name and usage", () => {
    try {
      parseConfigArgv(["--unknown-flag=foo"], { token: { type: "string" } }, ctx);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain("config workspace add");
      expect((err as UserError).message).toContain(ctx.usage);
    }
  });

  it("returns empty values map when no flags match the schema", () => {
    const r = parseConfigArgv<{ yes?: boolean }>(["T01"], { yes: { type: "boolean" } }, ctx);
    expect(r.values.yes).toBeUndefined();
    expect(r.positionals).toEqual(["T01"]);
  });
});
