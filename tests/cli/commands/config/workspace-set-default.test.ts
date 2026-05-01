import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultResolveDefaultTokensStore,
  type Effects,
} from "../../../../src/cli/commands/config/effects.ts";
import { workspaceSetDefaultHandler } from "../../../../src/cli/commands/config/workspace-set-default.ts";
import { UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { loadConfig, saveConfig } from "../../../../src/config/io.ts";
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
      throw new Error("not used");
    },
    createTokenStore: () => new MemoryTokenStore(),
    resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
    createSlackClient: () => {
      throw new Error("not used");
    },
    isTTY: () => false,
    ...overrides,
  };
}

const baseConfig: Config = {
  default_workspace: null,
  workspaces: {
    T01ABCDEF: { name: "Acme", default_channel: null, tokens_store: "file" },
  },
  output: { format: "jsonl", cache_window_days: 7 },
};

describe("config workspace set-default", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-setdefault-test-"));
    spyOn(process.stderr, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    mock.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it("(1) sets default_workspace when registered", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const code = await workspaceSetDefaultHandler(
      makeCtx({ rest: ["T01ABCDEF"] }),
      makeEffects({ configDir: dir }),
    );
    expect(code).toBe(0);
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.default_workspace).toBe("T01ABCDEF");
  });

  it("(2) throws UserError for unregistered team_id", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(
      workspaceSetDefaultHandler(
        makeCtx({ rest: ["T99NOTHERE"] }),
        makeEffects({ configDir: dir }),
      ),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("missing positional argument throws UserError", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(
      workspaceSetDefaultHandler(makeCtx({ rest: [] }), makeEffects({ configDir: dir })),
    ).rejects.toBeInstanceOf(UserError);
  });
});
