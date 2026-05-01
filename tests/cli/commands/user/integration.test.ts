import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../../../src/cli/index.ts";

/**
 * runCli-level smoke tests for `user`. Covers only failure paths that do
 * not need a TokenStore / Slack mock — exercises argv parsing and the
 * outer error layer. Mirrors `commands/post/integration.test.ts` and
 * `commands/download/integration.test.ts`.
 */
describe("runCli user (smoke)", () => {
  let stderrSpy: ReturnType<typeof spyOn> | null = null;
  let tmp: string | null = null;
  let savedXdg: string | undefined;
  let savedDefault: string | undefined;

  beforeEach(() => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

    tmp = mkdtempSync(join(tmpdir(), "slack-chan-user-it-"));
    savedXdg = process.env.XDG_CONFIG_HOME;
    savedDefault = process.env.SLACK_CHAN_DEFAULT_WORKSPACE;
    process.env.XDG_CONFIG_HOME = tmp;
    delete process.env.SLACK_CHAN_DEFAULT_WORKSPACE;
  });

  afterEach(() => {
    mock.restore();
    stderrSpy = null;
    if (tmp !== null) rmSync(tmp, { recursive: true, force: true });
    if (savedXdg === undefined) delete process.env.XDG_CONFIG_HOME;
    else process.env.XDG_CONFIG_HOME = savedXdg;
    if (savedDefault === undefined) delete process.env.SLACK_CHAN_DEFAULT_WORKSPACE;
    else process.env.SLACK_CHAN_DEFAULT_WORKSPACE = savedDefault;
  });

  function stderr(): string {
    return stderrSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }

  it("(1) no args → exit 1, missing <identifier>", async () => {
    const code = await runCli(["user"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing <identifier>");
  });

  it("(2) too many args → exit 1, too many arguments", async () => {
    const code = await runCli(["user", "a", "b", "c"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("too many arguments");
  });

  it("(3) workspace なし (config も env も空) → exit 1, no --workspace", async () => {
    const code = await runCli(["user", "U01ABCDEF"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("no --workspace");
  });

  it("(4) 空白のみ identifier → exit 1, non-empty", async () => {
    const code = await runCli(["user", "  "]);
    expect(code).toBe(1);
    expect(stderr()).toContain("non-empty");
  });

  it("(5) 制御文字を含む identifier → exit 1, control characters", async () => {
    const code = await runCli(["user", `bad${String.fromCharCode(0x01)}name`]);
    expect(code).toBe(1);
    expect(stderr()).toContain("control characters");
  });
});
