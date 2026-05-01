import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pkg from "../../package.json" with { type: "json" };
import { runCli } from "../../src/cli/index.ts";

describe("runCli integration", () => {
  let stdoutSpy: ReturnType<typeof spyOn> | null = null;
  let stderrSpy: ReturnType<typeof spyOn> | null = null;
  let savedDefaultWs: string | undefined;
  let savedDefaultCh: string | undefined;
  let savedXdgConfig: string | undefined;
  let xdgDir: string | null = null;

  beforeEach(async () => {
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    // ── M2: env を deterministic に
    savedDefaultWs = process.env.SLACK_CHAN_DEFAULT_WORKSPACE;
    savedDefaultCh = process.env.SLACK_CHAN_DEFAULT_CHANNEL;
    savedXdgConfig = process.env.XDG_CONFIG_HOME;
    delete process.env.SLACK_CHAN_DEFAULT_WORKSPACE;
    delete process.env.SLACK_CHAN_DEFAULT_CHANNEL;
    xdgDir = await mkdtemp(join(tmpdir(), "slack-chan-runcli-"));
    process.env.XDG_CONFIG_HOME = xdgDir;
  });

  afterEach(async () => {
    mock.restore();
    stdoutSpy = null;
    stderrSpy = null;
    if (savedDefaultWs !== undefined) process.env.SLACK_CHAN_DEFAULT_WORKSPACE = savedDefaultWs;
    else delete process.env.SLACK_CHAN_DEFAULT_WORKSPACE;
    if (savedDefaultCh !== undefined) process.env.SLACK_CHAN_DEFAULT_CHANNEL = savedDefaultCh;
    else delete process.env.SLACK_CHAN_DEFAULT_CHANNEL;
    if (savedXdgConfig !== undefined) process.env.XDG_CONFIG_HOME = savedXdgConfig;
    else delete process.env.XDG_CONFIG_HOME;
    if (xdgDir !== null) {
      await rm(xdgDir, { recursive: true, force: true });
      xdgDir = null;
    }
  });

  function stdout(): string {
    return stdoutSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }
  function stderr(): string {
    return stderrSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }

  it("(1) --help → exit 0 + lists 10 subcommands", async () => {
    const code = await runCli(["--help"]);
    expect(code).toBe(0);
    const out = stdout();
    for (const name of [
      "config",
      "read",
      "post",
      "dm",
      "download",
      "user",
      "search",
      "api",
      "sync",
      "stats",
    ]) {
      expect(out).toContain(name);
    }
  });

  it("(2) --version → exit 0 + prints package version", async () => {
    const code = await runCli(["--version"]);
    expect(code).toBe(0);
    expect(stdout()).toContain(pkg.version);
  });

  it("(3) read foo (no --workspace, no default) → exit 1 + 'workspace ... is required'", async () => {
    const code = await runCli(["read", "foo"]);
    expect(code).toBe(1);
    expect(stderr()).toMatch(/--workspace=T\.\.\. is required/);
  });

  it("(4) read foo --json --human → exit 1 + 'mutually exclusive'", async () => {
    const code = await runCli(["read", "foo", "--json", "--human"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("mutually exclusive");
  });

  it("(5) unknown subcommand → exit 1 + 'Unknown subcommand'", async () => {
    const code = await runCli(["nope"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("Unknown subcommand");
  });

  it("(6) no args → exit 0 + top-level help", async () => {
    const code = await runCli([]);
    expect(code).toBe(0);
    expect(stdout()).toContain("slack-chan");
  });

  it("(7) read --help → exit 0 + top-level help (T009 暫定挙動)", async () => {
    const code = await runCli(["read", "--help"]);
    expect(code).toBe(0);
    expect(stdout()).toContain("read");
    expect(stdout()).toContain("config");
  });

  it("(8) error message gets redacted of slack tokens", async () => {
    // Simulate a token leak via unknown subcommand name (it will be echoed in the error).
    const code = await runCli(["xoxb-1234-5678-abcdefghij"]);
    expect(code).toBe(1);
    const err = stderr();
    expect(err).not.toContain("xoxb-1234-5678-abcdefghij");
    expect(err).toMatch(/xoxb-\*\*\*/);
  });

  it("(9) post (no args) → exit 1 + 'missing <channel>'", async () => {
    const code = await runCli(["post"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("missing <channel>");
  });

  it("(10) post C123 hi --blocks=[] --file=/tmp/x → exit 1 + 'mutually exclusive'", async () => {
    const code = await runCli(["post", "C0123ABCDEF", "hi", "--blocks=[]", "--file=/tmp/x"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("mutually exclusive");
  });
});

describe("installGlobalHandlers", () => {
  // We can't safely test installGlobalHandlers + emit() because the handlers
  // call process.exit(), which would terminate the test runner. Instead, we
  // verify the function is exported and registers listeners we can detect.
  it("is exported and adds listeners for uncaughtException / unhandledRejection", async () => {
    const { installGlobalHandlers } = await import("../../src/cli/index.ts");
    const beforeUE = process.listenerCount("uncaughtException");
    const beforeUR = process.listenerCount("unhandledRejection");
    installGlobalHandlers();
    expect(process.listenerCount("uncaughtException")).toBeGreaterThan(beforeUE);
    expect(process.listenerCount("unhandledRejection")).toBeGreaterThan(beforeUR);
    // Clean up so we don't leak handlers into other tests.
    const ueListeners = process.listeners("uncaughtException");
    const lastUE = ueListeners[ueListeners.length - 1];
    if (lastUE) process.removeListener("uncaughtException", lastUE);
    const urListeners = process.listeners("unhandledRejection");
    const lastUR = urListeners[urListeners.length - 1];
    if (lastUR) process.removeListener("unhandledRejection", lastUR);
  });
});
