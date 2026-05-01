import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultResolveDefaultTokensStore,
  type Effects,
} from "../../../../src/cli/commands/config/effects.ts";
import { workspaceListHandler } from "../../../../src/cli/commands/config/workspace-list.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { saveConfig } from "../../../../src/config/io.ts";
import type { Config, TokensStore } from "../../../../src/config/types.ts";
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
      throw new Error("openDb not used in list tests");
    },
    createTokenStore: () => new MemoryTokenStore(),
    resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
    createSlackClient: () => {
      throw new Error("createSlackClient not used in list tests");
    },
    ...overrides,
  };
}

describe("config workspace list", () => {
  let dir: string;
  let stdoutSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-list-test-"));
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    mock.restore();
    stdoutSpy = null;
    await rm(dir, { recursive: true, force: true });
  });

  function out(): string {
    return stdoutSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }

  it("(1) empty workspaces → empty output (jsonl)", async () => {
    await saveConfig(
      {
        default_workspace: null,
        workspaces: {},
        output: { format: "jsonl", cache_window_days: 7 },
      },
      { configDir: dir },
    );
    const code = await workspaceListHandler(makeCtx(), makeEffects({ configDir: dir }));
    expect(code).toBe(0);
    expect(out()).toBe("");
  });

  it("(2) reads token via TokenStore.get and redacts to xoxb-***xxxx", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T01ABCDEF: { name: "Acme", default_channel: null, tokens_store: "file" },
      },
      output: { format: "jsonl", cache_window_days: 7 },
    };
    await saveConfig(cfg, { configDir: dir });
    const store = new MemoryTokenStore();
    await store.set("T01ABCDEF", "xoxb-test-1234567890abcd");

    const code = await workspaceListHandler(
      makeCtx({ format: "jsonl" }),
      makeEffects({ configDir: dir, createTokenStore: () => store }),
    );
    expect(code).toBe(0);
    const line = out().trim();
    const parsed = JSON.parse(line) as { team_id: string; token: string };
    expect(parsed.team_id).toBe("T01ABCDEF");
    expect(parsed.token).toMatch(/^xoxb-\*\*\*[a-z0-9]{4}$/i);
    expect(parsed.token).not.toContain("test-1234");
  });

  it("(3) human format: 表整形 (header + ─ separator + 行)", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T01ABCDEF: { name: "Acme", default_channel: "C1", tokens_store: "file" },
      },
      output: { format: "human", cache_window_days: 7 },
    };
    await saveConfig(cfg, { configDir: dir });
    const store = new MemoryTokenStore();
    await store.set("T01ABCDEF", "xoxb-test-1234567890abcd");
    const code = await workspaceListHandler(
      makeCtx({ format: "human" }),
      makeEffects({ configDir: dir, createTokenStore: () => store }),
    );
    expect(code).toBe(0);
    const text = out();
    const lines = text.split("\n");
    expect(lines[0]).toContain("TEAM_ID");
    expect(lines[0]).toContain("NAME");
    expect(lines[0]).toContain("DEFAULT_CHANNEL");
    expect(lines[0]).toContain("TOKENS_STORE");
    expect(lines[0]).toContain("TOKEN");
    expect(lines[1]).toMatch(/^─+/);
    expect(lines[2]).toContain("T01ABCDEF");
    expect(lines[2]).toContain("Acme");
    expect(lines[2]).toContain("C1");
    expect(lines[2]).toContain("file");
    // 旧仕様 (`tokens_store    =`) は出ない
    expect(text).not.toContain("tokens_store    =");
  });

  it("(4) workspace without a stored token → token: null", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T01ABCDEF: { name: "Acme", default_channel: null, tokens_store: "file" },
      },
      output: { format: "jsonl", cache_window_days: 7 },
    };
    await saveConfig(cfg, { configDir: dir });
    const code = await workspaceListHandler(
      makeCtx({ format: "jsonl" }),
      makeEffects({ configDir: dir, createTokenStore: () => new MemoryTokenStore() }),
    );
    expect(code).toBe(0);
    const parsed = JSON.parse(out().trim()) as { token: string | null };
    expect(parsed.token).toBeNull();
  });

  it("(5) rich format: 🏢 banner + table (with ANSI; non-TTY → no color but emoji from default-off)", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T01ABCDEF: { name: "Acme", default_channel: "C1", tokens_store: "file" },
      },
      output: { format: "rich", cache_window_days: 7 },
    };
    await saveConfig(cfg, { configDir: dir });
    const store = new MemoryTokenStore();
    await store.set("T01ABCDEF", "xoxb-test-1234567890abcd");
    const code = await workspaceListHandler(
      makeCtx({ format: "rich" }),
      makeEffects({ configDir: dir, createTokenStore: () => store }),
    );
    expect(code).toBe(0);
    const text = out();
    const lines = text.split("\n");
    // Banner is the first line; non-TTY suppresses both color and emoji,
    // so the banner reduces to plain "Workspaces".
    expect(lines[0]).toBe("Workspaces");
    expect(lines[1]).toContain("TEAM_ID");
    expect(lines[2]).toMatch(/^─+/);
    expect(lines[3]).toContain("T01ABCDEF");
  });

  it("groups team_ids by tokens_store kind so the factory only builds each backend once", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T01: { name: "A", default_channel: null, tokens_store: "file" },
        T02: { name: "B", default_channel: null, tokens_store: "file" },
      },
      output: { format: "jsonl", cache_window_days: 7 },
    };
    await saveConfig(cfg, { configDir: dir });

    const calls: TokensStore[] = [];
    const store = new MemoryTokenStore();
    const code = await workspaceListHandler(
      makeCtx({ format: "jsonl" }),
      makeEffects({
        configDir: dir,
        createTokenStore: (kind) => {
          calls.push(kind);
          return store;
        },
      }),
    );
    expect(code).toBe(0);
    expect(calls).toEqual(["file"]);
  });
});
