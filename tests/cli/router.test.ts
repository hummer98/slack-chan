import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { COMMAND_NAMES, COMMANDS } from "../../src/cli/commands/index.ts";
import { UserError } from "../../src/cli/errors.ts";
import { type CommandContext, dispatch } from "../../src/cli/router.ts";
import { StderrLogger } from "../../src/output/logger.ts";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspace: null,
    format: "jsonl",
    verbose: false,
    rest: [],
    logger: new StderrLogger(),
    ...overrides,
  };
}

describe("dispatch", () => {
  let stderrSpy: ReturnType<typeof spyOn> | null = null;
  let stdoutSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(() => {
    stderrSpy = spyOn(process.stderr, "write").mockImplementation(() => true);
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mock.restore();
    stderrSpy = null;
    stdoutSpy = null;
  });

  it("(1) dispatch('read') → 1 (stub)", async () => {
    const code = await dispatch("read", makeCtx());
    expect(code).toBe(1);
  });

  it("(2) dispatch unknown subcommand → throws UserError", async () => {
    await expect(dispatch("nope", makeCtx())).rejects.toBeInstanceOf(UserError);
  });

  it("(3) dispatch(null) → 0 and writes top-level help to stdout", async () => {
    const code = await dispatch(null, makeCtx());
    expect(code).toBe(0);
    const calls = stdoutSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
    expect(calls).toContain("slack-chan");
  });

  it("(4) COMMANDS has exactly 10 entries", () => {
    expect(Object.keys(COMMANDS).length).toBe(10);
    expect(COMMAND_NAMES.length).toBe(10);
    for (const name of COMMAND_NAMES) {
      expect(typeof COMMANDS[name]).toBe("function");
    }
  });

  it("(5) all 10 stubs return EXIT_USER_ERROR (1)", async () => {
    for (const name of COMMAND_NAMES) {
      const code = await dispatch(name, makeCtx());
      expect(code).toBe(1);
    }
  });

  it("(6) config nested: rest=['workspace','add'] → stub message uses 'config workspace'", async () => {
    const code = await dispatch("config", makeCtx({ rest: ["workspace", "add"] }));
    expect(code).toBe(1);
    const stderr = stderrSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
    expect(stderr).toContain("config workspace");
  });
});
