import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { channelSetDefaultHandler } from "../../../../src/cli/commands/config/channel-set-default.ts";
import {
  defaultResolveDefaultTokensStore,
  type Effects,
} from "../../../../src/cli/commands/config/effects.ts";
import { UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { loadConfig, saveConfig } from "../../../../src/config/io.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as workspacesDao from "../../../../src/storage/dao/workspaces.ts";
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

interface ChannelStub {
  id: string;
  name: string;
  name_normalized?: string;
}

function makeEffects(opts: {
  configDir: string;
  store?: MemoryTokenStore;
  channels?: ChannelStub[];
  conversationsListThrows?: unknown;
  conversationsListNotOk?: { error: string };
}): { effects: Effects; db: ReturnType<typeof openDatabase> } {
  const store = opts.store ?? new MemoryTokenStore();
  const db = openDatabase({ path: ":memory:" });
  return {
    db,
    effects: {
      configDir: opts.configDir,
      env: {},
      platform: "linux",
      openDb: () => db,
      createTokenStore: () => store,
      resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
      createSlackClient: (team_id, token) => {
        const client = new SlackClient({ team_id, token });
        Object.defineProperty(client, "conversationsList", {
          value: async () => {
            if (opts.conversationsListThrows !== undefined) {
              throw opts.conversationsListThrows;
            }
            if (opts.conversationsListNotOk !== undefined) {
              return { ok: false, error: opts.conversationsListNotOk.error };
            }
            return { ok: true, channels: opts.channels ?? [] };
          },
        });
        return client;
      },
    },
  };
}

const baseConfig: Config = {
  default_workspace: null,
  workspaces: {
    T01ABCDEF: { name: "Acme", default_channel: null, tokens_store: "file" },
  },
  output: { format: "jsonl", cache_window_days: 7 },
};

describe("config channel set-default", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-channel-test-"));
  });

  afterEach(async () => {
    mock.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it("(1) Cxxxx ID is used directly without conversations.list call", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const { effects, db } = makeEffects({ configDir: dir });
    const code = await channelSetDefaultHandler(
      makeCtx({ rest: ["T01ABCDEF", "C12345678"] }),
      effects,
    );
    expect(code).toBe(0);
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF?.default_channel).toBe("C12345678");
    db.close();
  });

  it("(2) channel name resolves to id via conversations.list", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const store = new MemoryTokenStore();
    await store.set("T01ABCDEF", "xoxb-test-1234567890abcd");
    workspacesDao.insert(openDatabase({ path: ":memory:" }), {
      team_id: "T01ABCDEF",
      name: "Acme",
      url: null,
      default_channel: null,
      added_at: 1700000000,
    });
    const { effects, db } = makeEffects({
      configDir: dir,
      store,
      channels: [
        { id: "C100", name: "general", name_normalized: "general" },
        { id: "C200", name: "random", name_normalized: "random" },
      ],
    });
    const code = await channelSetDefaultHandler(
      makeCtx({ rest: ["T01ABCDEF", "general"] }),
      effects,
    );
    expect(code).toBe(0);
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF?.default_channel).toBe("C100");
    db.close();
  });

  it("(3) #-prefix is stripped before name lookup", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const store = new MemoryTokenStore();
    await store.set("T01ABCDEF", "xoxb-test-1234567890abcd");
    const { effects, db } = makeEffects({
      configDir: dir,
      store,
      channels: [{ id: "C100", name: "general", name_normalized: "general" }],
    });
    const code = await channelSetDefaultHandler(
      makeCtx({ rest: ["T01ABCDEF", "#general"] }),
      effects,
    );
    expect(code).toBe(0);
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF?.default_channel).toBe("C100");
    db.close();
  });

  it("(4) zero hits → UserError with the §6.3 message", async () => {
    await saveConfig(
      {
        default_workspace: null,
        workspaces: {
          T123: { name: "Acme", default_channel: null, tokens_store: "file" },
        },
        output: { format: "jsonl", cache_window_days: 7 },
      },
      { configDir: dir },
    );
    const store = new MemoryTokenStore();
    await store.set("T123", "xoxb-test-1234567890abcd");
    const { effects, db } = makeEffects({ configDir: dir, store, channels: [] });
    try {
      await channelSetDefaultHandler(makeCtx({ rest: ["T123", "general"] }), effects);
      throw new Error("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as UserError).message).toContain(
        "Channel 'general' not found in T123. Try the channel ID (Cxxxx) directly, or check --workspace.",
      );
    }
    db.close();
  });
});
