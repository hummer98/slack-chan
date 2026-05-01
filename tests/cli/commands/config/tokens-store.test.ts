import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultResolveDefaultTokensStore,
  type Effects,
} from "../../../../src/cli/commands/config/effects.ts";
import { tokensStoreHandler } from "../../../../src/cli/commands/config/tokens-store.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { loadConfig, saveConfig } from "../../../../src/config/io.ts";
import type { Config, TokensStore } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

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

interface MakeOpts {
  configDir: string;
  oldStore?: MemoryTokenStore;
  newStore?: MemoryTokenStore;
  /** Spy hook on createTokenStore. */
  recordTokenStoreCalls?: TokensStore[];
}

function makeEffects(opts: MakeOpts): Effects {
  const stores = new Map<TokensStore, MemoryTokenStore>();
  if (opts.oldStore !== undefined) stores.set("file", opts.oldStore);
  if (opts.newStore !== undefined) stores.set("keychain", opts.newStore);
  return {
    configDir: opts.configDir,
    env: {},
    platform: "darwin",
    openDb: () => openDatabase({ path: ":memory:" }),
    createTokenStore: (kind) => {
      if (opts.recordTokenStoreCalls !== undefined) opts.recordTokenStoreCalls.push(kind);
      const cached = stores.get(kind);
      if (cached !== undefined) return cached;
      const fresh = new MemoryTokenStore();
      stores.set(kind, fresh);
      return fresh;
    },
    resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
    createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
    isTTY: () => false,
  };
}

const baseConfig: Config = {
  default_workspace: null,
  workspaces: {
    T01ABCDEF: { name: "Acme", default_channel: null, tokens_store: "file" },
    T02XYZ: { name: "Beta", default_channel: null, tokens_store: "file" },
  },
  output: { format: "jsonl", cache_window_days: 7 },
};

describe("config tokens-store", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-tokensstore-test-"));
  });

  afterEach(async () => {
    mock.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it("(1) file → keychain migration runs A → B → C with bulk setWorkspaces", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const oldStore = new MemoryTokenStore();
    await oldStore.set("T01ABCDEF", "xoxb-test-aaaaaaaa1234");
    await oldStore.set("T02XYZ", "xoxb-test-bbbbbbbb5678");
    const newStore = new MemoryTokenStore();
    const calls: TokensStore[] = [];

    const code = await tokensStoreHandler(
      makeCtx({ rest: ["keychain"] }),
      makeEffects({ configDir: dir, oldStore, newStore, recordTokenStoreCalls: calls }),
    );
    expect(code).toBe(0);

    // A: コピー成功
    expect(await newStore.get("T01ABCDEF")).toBe("xoxb-test-aaaaaaaa1234");
    expect(await newStore.get("T02XYZ")).toBe("xoxb-test-bbbbbbbb5678");
    // C: 旧 store は削除済み
    expect(await oldStore.get("T01ABCDEF")).toBeUndefined();
    expect(await oldStore.get("T02XYZ")).toBeUndefined();
    // B: config の更新（bulk なので 1 回の disk write、両 ws が新値）
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF?.tokens_store).toBe("keychain");
    expect(cfg.workspaces.T02XYZ?.tokens_store).toBe("keychain");
    // createTokenStore は old / new の 2 種類しか作っていない
    expect(calls).toEqual(["file", "keychain"]);
  });

  it("(2) フェーズ A 失敗時に config が更新されない", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const oldStore = new MemoryTokenStore();
    await oldStore.set("T01ABCDEF", "xoxb-test-aaaaaaaa1234");
    await oldStore.set("T02XYZ", "xoxb-test-bbbbbbbb5678");
    const newStore = new MemoryTokenStore();
    // newStore.set を 2 回目で throw
    let setCalls = 0;
    const origSet = newStore.set.bind(newStore);
    Object.defineProperty(newStore, "set", {
      value: async (id: string, tok: string) => {
        setCalls += 1;
        if (setCalls >= 2) throw new Error("simulated newStore failure");
        return origSet(id, tok);
      },
    });

    expect(
      tokensStoreHandler(
        makeCtx({ rest: ["keychain"] }),
        makeEffects({ configDir: dir, oldStore, newStore }),
      ),
    ).rejects.toThrow();

    // config は file のまま
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF?.tokens_store).toBe("file");
    expect(cfg.workspaces.T02XYZ?.tokens_store).toBe("file");
  });

  it("(3) すでに同 kind の場合は no-op", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const oldStore = new MemoryTokenStore();
    await oldStore.set("T01ABCDEF", "xoxb-test-aaaaaaaa1234");

    const code = await tokensStoreHandler(
      makeCtx({ rest: ["file"] }),
      makeEffects({ configDir: dir, oldStore }),
    );
    expect(code).toBe(0);
    expect(await oldStore.get("T01ABCDEF")).toBe("xoxb-test-aaaaaaaa1234");
  });

  it("(4) workspaces 0 件 → no-op", async () => {
    await saveConfig(
      {
        default_workspace: null,
        workspaces: {},
        output: { format: "jsonl", cache_window_days: 7 },
      },
      { configDir: dir },
    );
    const code = await tokensStoreHandler(
      makeCtx({ rest: ["keychain"] }),
      makeEffects({ configDir: dir }),
    );
    expect(code).toBe(0);
  });

  it("(5) フェーズ C で oldStore.delete が throw しても exit code 0 (warning)", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const oldStore = new MemoryTokenStore();
    await oldStore.set("T01ABCDEF", "xoxb-test-aaaaaaaa1234");
    await oldStore.set("T02XYZ", "xoxb-test-bbbbbbbb5678");
    Object.defineProperty(oldStore, "delete", {
      value: async () => {
        throw new Error("simulated cleanup failure");
      },
    });
    const newStore = new MemoryTokenStore();

    const code = await tokensStoreHandler(
      makeCtx({ rest: ["keychain"] }),
      makeEffects({ configDir: dir, oldStore, newStore }),
    );
    expect(code).toBe(0);
    // config は新値で commit 済み
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF?.tokens_store).toBe("keychain");
  });
});
