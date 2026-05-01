import { describe, expect, test } from "bun:test";
import { parseReadArgv, parseSince } from "../../../../src/cli/commands/read/argv.ts";
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

describe("parseReadArgv", () => {
  test("(1) <channel> is required when no positional given", () => {
    expectUserError(() => parseReadArgv([]), "<channel> is required");
  });

  test("(2) too many arguments rejects > 1 positionals", () => {
    expectUserError(() => parseReadArgv(["foo", "bar"]), "too many arguments");
  });

  test("(3) unknown option rejected with 'Unknown option'", () => {
    expectUserError(() => parseReadArgv(["foo", "--frob"]), "Unknown option");
  });

  test("(4) --limit=50 parses to number 50; default is 100", () => {
    expect(parseReadArgv(["foo", "--limit=50"]).limit).toBe(50);
    expect(parseReadArgv(["foo"]).limit).toBe(100);
  });

  test("(5) invalid --limit values rejected", () => {
    expectUserError(
      () => parseReadArgv(["foo", "--limit=0"]),
      "--limit must be an integer in [1, 1000]",
    );
    expectUserError(
      () => parseReadArgv(["foo", "--limit=2000"]),
      "--limit must be an integer in [1, 1000]",
    );
    expectUserError(
      () => parseReadArgv(["foo", "--limit=abc"]),
      "--limit must be an integer in [1, 1000]",
    );
  });

  test("(6) --since= duration units", () => {
    expect(parseSince("7d")).toBe(7 * 86400);
    expect(parseSince("3h")).toBe(3 * 3600);
    expect(parseSince("30m")).toBe(30 * 60);
    expect(parseSince("600s")).toBe(600);
    expect(parseReadArgv(["foo", "--since=7d"]).since_sec).toBe(7 * 86400);
  });

  test("(7) invalid --since values rejected", () => {
    expectUserError(() => parseReadArgv(["foo", "--since=invalid"]), "is not a valid duration");
    expectUserError(() => parseReadArgv(["foo", "--since=3.5d"]), "is not a valid duration");
    expectUserError(() => parseReadArgv(["foo", "--since="]), "is not a valid duration");
  });

  test("(8) --since=370d exceeds 365 days", () => {
    expectUserError(() => parseReadArgv(["foo", "--since=370d"]), "exceeds 365 days");
  });

  test("(9) --since=0d → 'must be a positive duration' (Mi1)", () => {
    expectUserError(() => parseReadArgv(["foo", "--since=0d"]), "must be a positive duration");
    expectUserError(() => parseSince("0s"), "must be a positive duration");
  });

  test("(10) --thread=<valid ts> parses through", () => {
    const args = parseReadArgv(["foo", "--thread=1700000000.000100"]);
    expect(args.thread).toBe("1700000000.000100");
  });

  test("(11) --thread=<invalid> rejected", () => {
    expectUserError(() => parseReadArgv(["foo", "--thread=bad"]), "is not a valid Slack ts");
  });

  test("(12) --refresh / --full-edit-scan boolean", () => {
    const r = parseReadArgv(["foo", "--refresh", "--full-edit-scan"]);
    expect(r.refresh).toBe(true);
    expect(r.fullEditScan).toBe(true);

    const r2 = parseReadArgv(["foo"]);
    expect(r2.refresh).toBe(false);
    expect(r2.fullEditScan).toBe(false);
  });
});
