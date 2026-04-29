import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultResolveDefaultTokensStore,
  type Effects,
} from "../../../../src/cli/commands/config/effects.ts";
import { showHandler } from "../../../../src/cli/commands/config/show.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { saveConfig } from "../../../../src/config/io.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";

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

function makeEffects(overrides: Partial<Effects>): Effects {
  return {
    configDir: "/tmp",
    env: {},
    platform: "linux",
    openDb: () => {
      throw new Error("openDb not used in show tests");
    },
    createTokenStore: () => new MemoryTokenStore(),
    resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
    createSlackClient: () => {
      throw new Error("createSlackClient not used in show tests");
    },
    ...overrides,
  };
}

const baseConfig: Config = {
  default_workspace: "T01ABCDEF",
  workspaces: {
    T01ABCDEF: { name: "Acme", default_channel: "C0123456", tokens_store: "file" },
  },
  output: { format: "jsonl", cache_window_days: 7 },
};

describe("config show", () => {
  let dir: string;
  let stdoutSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-show-test-"));
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    mock.restore();
    stdoutSpy = null;
    await rm(dir, { recursive: true, force: true });
  });

  function stdoutOutput(): string {
    return stdoutSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }

  it("emits jsonl record without env override fields when env is empty", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const code = await showHandler(makeCtx({ format: "jsonl" }), makeEffects({ configDir: dir }));
    expect(code).toBe(0);
    const out = stdoutOutput();
    const parsed = JSON.parse(out.trim()) as Record<string, unknown>;
    expect(parsed.default_workspace).toBe("T01ABCDEF");
    expect(parsed.default_workspace_override).toBeUndefined();
    expect(parsed.default_channel_override).toBeUndefined();
    expect(parsed.output_format_override).toBeUndefined();
  });

  it("marks env override fields when SLACK_CHAN_DEFAULT_WORKSPACE is set", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const code = await showHandler(
      makeCtx({ format: "jsonl" }),
      makeEffects({
        configDir: dir,
        env: { SLACK_CHAN_DEFAULT_WORKSPACE: "T99FROMENV" },
      }),
    );
    expect(code).toBe(0);
    const out = stdoutOutput();
    const parsed = JSON.parse(out.trim()) as Record<string, unknown>;
    const ovr = parsed.default_workspace_override as { source: string; env: string };
    expect(ovr.source).toBe("env");
    expect(ovr.env).toBe("SLACK_CHAN_DEFAULT_WORKSPACE");
  });

  it("human format includes env-suffix line", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const code = await showHandler(
      makeCtx({ format: "human" }),
      makeEffects({
        configDir: dir,
        env: { SLACK_CHAN_DEFAULT_WORKSPACE: "T99FROMENV" },
      }),
    );
    expect(code).toBe(0);
    const out = stdoutOutput();
    expect(out).toContain("SLACK_CHAN_DEFAULT_WORKSPACE");
    expect(out).toContain("default_workspace");
  });

  it("does not leak full token values into output (workspaces show no token field here)", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const code = await showHandler(makeCtx({ format: "jsonl" }), makeEffects({ configDir: dir }));
    expect(code).toBe(0);
    const out = stdoutOutput();
    expect(out).not.toContain("xoxb-");
    expect(out).not.toContain("xoxp-");
  });
});
