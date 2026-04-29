import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { runCli } from "../../../../src/cli/index.ts";

/**
 * runCli-level smoke tests for `dm`. Covers only failure paths that do not
 * need a TokenStore / Slack mock — argv parsing and outer error layer.
 */
describe("runCli dm (smoke)", () => {
  let stderrSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(() => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mock.restore();
    stderrSpy = null;
  });

  function stderr(): string {
    return stderrSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }

  it("(1) no args → exit 1, missing <user>", async () => {
    const code = await runCli(["dm"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing <user>");
  });

  it("(2) only user (write mode 想定) → exit 1, missing <text>", async () => {
    const code = await runCli(["dm", "U0123ABCDEF"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing <text>");
  });

  it("(3) --read + --file → mutually exclusive", async () => {
    const code = await runCli(["dm", "U0123ABCDEF", "--read", "--file=/tmp/x"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("--file / --blocks cannot be combined");
  });

  it("(4) write mode で --limit → UserError", async () => {
    const code = await runCli(["dm", "U0123ABCDEF", "hi", "--limit=10"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("only valid with --read");
  });

  it("(5) <user> 形式違反 → UserError", async () => {
    const code = await runCli(["dm", "badformat", "hi"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("not a valid");
  });
});
