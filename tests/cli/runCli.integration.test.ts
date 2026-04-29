import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import pkg from "../../package.json" with { type: "json" };
import { runCli } from "../../src/cli/index.ts";

describe("runCli integration", () => {
  let stdoutSpy: ReturnType<typeof spyOn> | null = null;
  let stderrSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(() => {
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mock.restore();
    stdoutSpy = null;
    stderrSpy = null;
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

  it("(3) read foo --workspace=T123 → exit 1 + 'not implemented' on stderr", async () => {
    const code = await runCli(["read", "foo", "--workspace=T123"]);
    expect(code).toBe(1);
    expect(stderr()).toContain("not implemented");
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
