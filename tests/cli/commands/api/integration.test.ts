import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { runCli } from "../../../../src/cli/index.ts";

/**
 * runCli-level smoke tests for `api`. Covers only failure paths that do not
 * need a TokenStore / Slack mock — exercises argv parsing, params parsing,
 * and the explicit-workspace requirement.
 */
describe("runCli api (smoke)", () => {
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

  it("(1) no args → exit 1, missing <method>", async () => {
    const code = await runCli(["api"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing <method>");
  });

  it("(2) method only (no --workspace) → exit 1, '--workspace=<id> is required'", async () => {
    const code = await runCli(["api", "conversations.info"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("--workspace=<id> is required");
  });

  it("(3) --workspace format mismatch → exit 1, 'must match'", async () => {
    const code = await runCli(["--workspace=Tbad!", "api", "conversations.info"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("must match");
  });

  it("(4) param syntax error fires before workspace check", async () => {
    const code = await runCli(["api", "conversations.info", "bad-key=v"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("invalid parameter key");
  });

  it("(5) unknown subcommand flag → exit 1", async () => {
    const code = await runCli([
      "--workspace=T01ABCDEFG",
      "api",
      "conversations.info",
      "--unknown=x",
    ]);
    expect(code).toBe(1);
  });

  it("(6) invalid method format → exit 1, 'is not a valid'", async () => {
    const code = await runCli(["api", "Conversations.history"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("is not a valid");
  });
});
