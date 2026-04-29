import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { runCli } from "../../../../src/cli/index.ts";

/**
 * runCli-level smoke tests for `post`. Covers only failure paths that do not
 * need a TokenStore / Slack mock — this exercises argv parsing and the
 * outer error-redaction layer the handler tests cannot reach.
 */
describe("runCli post (smoke)", () => {
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

  it("(1) no args → exit 1, missing <channel>", async () => {
    const code = await runCli(["post"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing <channel>");
  });

  it("(2) only channel → exit 1, missing <text>", async () => {
    const code = await runCli(["post", "C0123ABCDEF"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing <text>");
  });

  it("(3) --thread=invalid → exit 1", async () => {
    const code = await runCli(["post", "C0123ABCDEF", "hi", "--thread=invalid"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Slack ts format");
  });

  it("(4) --blocks + --file → mutually exclusive", async () => {
    const code = await runCli(["post", "C0123ABCDEF", "hi", "--blocks=[]", "--file=/tmp/x"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("mutually exclusive");
  });
});
