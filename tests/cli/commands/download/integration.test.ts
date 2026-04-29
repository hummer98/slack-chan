import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../../../src/cli/index.ts";

/**
 * runCli-level smoke tests for `download`. Covers only failure paths that
 * do not need a TokenStore / Slack mock — exercises argv parsing and the
 * outer error-redaction layer. Mirrors `commands/post/integration.test.ts`.
 */
describe("runCli download (smoke)", () => {
  let stderrSpy: ReturnType<typeof spyOn> | null = null;
  let tmp: string | null = null;
  let savedXdg: string | undefined;
  let savedDefault: string | undefined;

  beforeEach(() => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

    // Isolate config dir + clear default-workspace env so workspace-resolution
    // tests are deterministic across hosts (I-6).
    tmp = mkdtempSync(join(tmpdir(), "slack-chan-dl-it-"));
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

  it("(1) no args → exit 1, missing <ts>", async () => {
    const code = await runCli(["download"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing <ts>");
  });

  it("(2) invalid ts → exit 1, Slack ts format", async () => {
    const code = await runCli(["download", "abc"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Slack ts format");
  });

  it("(3) --channel=@bad → exit 1, not a valid channel id", async () => {
    const code = await runCli(["download", "1700000000.001000", "--channel=@bad"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("not a valid channel id");
  });

  it("(4) workspace なし (config も env も空) → exit 1, no --workspace (I-6)", async () => {
    const code = await runCli(["download", "1700000000.001000"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("no --workspace");
  });

  it("(5) --out= 空 → exit 1", async () => {
    const code = await runCli(["download", "1700000000.001000", "--out="]);
    expect(code).toBe(1);
    expect(stderr()).toContain("non-empty");
  });
});
