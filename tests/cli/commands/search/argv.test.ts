import { describe, expect, test } from "bun:test";
import { parseSearchArgv } from "../../../../src/cli/commands/search/argv.ts";
import { UserError } from "../../../../src/cli/errors.ts";

function expectUserError(fn: () => unknown, includes: string): void {
  try {
    fn();
    throw new Error("expected UserError");
  } catch (err) {
    expect(err).toBeInstanceOf(UserError);
    expect((err as Error).message).toContain(includes);
  }
}

describe("parseSearchArgv", () => {
  test("(1) <query> only -> default args", () => {
    const a = parseSearchArgv(["hello"]);
    expect(a.query).toBe("hello");
    expect(a.in).toBeNull();
    expect(a.from).toBeNull();
    expect(a.cachedOnly).toBe(false);
    expect(a.limit).toBe(50);
  });

  test("(2) --in=#ops keeps raw input", () => {
    const a = parseSearchArgv(["hello", "--in=#ops"]);
    expect(a.in).toBe("#ops");
  });

  test("(3) --from=@alice keeps raw input", () => {
    const a = parseSearchArgv(["hello", "--from=@alice"]);
    expect(a.from).toBe("@alice");
  });

  test("(4) --cached-only -> cachedOnly=true", () => {
    const a = parseSearchArgv(["hello", "--cached-only"]);
    expect(a.cachedOnly).toBe(true);
  });

  test("(5) --limit=10 parses; default 50", () => {
    expect(parseSearchArgv(["hello", "--limit=10"]).limit).toBe(10);
    expect(parseSearchArgv(["hello"]).limit).toBe(50);
  });

  test("(6) --limit out of range / non-integer rejected", () => {
    expectUserError(
      () => parseSearchArgv(["hello", "--limit=2000"]),
      "--limit must be an integer in [1, 1000]",
    );
    expectUserError(
      () => parseSearchArgv(["hello", "--limit=0"]),
      "--limit must be an integer in [1, 1000]",
    );
    expectUserError(
      () => parseSearchArgv(["hello", "--limit=abc"]),
      "--limit must be an integer in [1, 1000]",
    );
    expectUserError(
      () => parseSearchArgv(["hello", "--limit="]),
      "--limit must be an integer in [1, 1000]",
    );
  });

  test("(7) positionals 0 -> UserError", () => {
    expectUserError(() => parseSearchArgv([]), "<query> is required");
  });

  test("(8) positionals > 1 -> UserError too many", () => {
    expectUserError(() => parseSearchArgv(["hello", "world"]), "too many arguments");
  });

  test("(9) <query> empty / whitespace only -> UserError", () => {
    expectUserError(() => parseSearchArgv([""]), "<query> must be a non-empty string");
    expectUserError(() => parseSearchArgv(["   "]), "<query> must be a non-empty string");
  });

  test("(10) <query> with C0 control char rejected", () => {
    expectUserError(
      () => parseSearchArgv(["helloworld"]),
      "<query> must not contain control characters",
    );
  });

  test("(11) --in= empty string rejected", () => {
    expectUserError(() => parseSearchArgv(["hello", "--in="]), "--in must be a non-empty string");
  });

  test("(12) --in with control char rejected", () => {
    expectUserError(
      () => parseSearchArgv(["hello", "--in=ops"]),
      "--in must not contain control characters",
    );
  });

  test("(13) --from= empty string rejected", () => {
    expectUserError(
      () => parseSearchArgv(["hello", "--from="]),
      "--from must be a non-empty string",
    );
  });

  test("(14) unknown flag rejected by parseArgs strict", () => {
    expectUserError(() => parseSearchArgv(["hello", "--frob"]), "Unknown option");
  });
});
