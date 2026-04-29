import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runCli } from "../../../../src/cli/index.ts";

/**
 * runCli-level smoke tests for `search`. Covers argv / outer error paths only
 * (does not exercise the keychain or Slack HTTP). Mirrors `commands/user/integration.test.ts`.
 */
describe("runCli search (smoke)", () => {
  let stderrSpy: ReturnType<typeof spyOn> | null = null;
  let tmp: string | null = null;
  let savedXdg: string | undefined;
  let savedDefault: string | undefined;

  beforeEach(() => {
    spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);

    tmp = mkdtempSync(join(tmpdir(), "slack-chan-search-it-"));
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

  it("(1) no args -> exit 1, <query> is required", async () => {
    const code = await runCli(["search"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("<query> is required");
  });

  it("(2) too many positionals -> exit 1, too many arguments", async () => {
    const code = await runCli(["search", "hello", "world"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("too many arguments");
  });

  it("(3) workspace 未指定 (config / env も空) -> exit 1", async () => {
    const code = await runCli(["search", "hello"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("no --workspace");
  });

  it("(4) --limit out of range -> exit 1", async () => {
    const code = await runCli(["search", "hello", "--limit=2000"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("--limit must be an integer in [1, 1000]");
  });

  it("(5) <query> with control char -> exit 1", async () => {
    const code = await runCli(["search", `bad${String.fromCharCode(0x01)}word`]);
    expect(code).toBe(1);
    expect(stderr()).toContain("control characters");
  });
});
