import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { ErrorCode } from "@slack/web-api";
import type { Effects } from "../../../../src/cli/commands/dm/effects.ts";
import { handleDm } from "../../../../src/cli/commands/dm/handler.ts";
import { TransientError, UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { saveConfig } from "../../../../src/config/io.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

const TEAM = "T01ABCDEF";
const TOKEN_BOT = "xoxb-test-1234567890abcd";

interface ApiStubs {
  usersLookupByEmail?: (args: Record<string, unknown>) => Promise<unknown>;
  usersList?: (args: Record<string, unknown>) => Promise<unknown>;
  conversationsOpen?: (args: Record<string, unknown>) => Promise<unknown>;
  chatPostMessage?: (args: Record<string, unknown>) => Promise<unknown>;
  chatPostMessageCaptured?: { args?: Record<string, unknown> };
  conversationsHistory?: (args: Record<string, unknown>) => Promise<unknown>;
  conversationsRepliesArgs?: { value?: Record<string, unknown> };
  conversationsReplies?: (args: Record<string, unknown>) => Promise<unknown>;
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspace: TEAM,
    format: "jsonl",
    verbose: false,
    rest: [],
    logger: new StderrLogger(),
    ...overrides,
  };
}

const baseConfig: Config = {
  default_workspace: null,
  workspaces: {
    [TEAM]: { name: "Acme", default_channel: null, tokens_store: "file" },
  },
  output: { format: "jsonl", cache_window_days: 7 },
};

interface MakeEffectsOpts {
  configDir: string;
  store: MemoryTokenStore;
  db: Database;
  stdout: NodeJS.WritableStream;
  api?: ApiStubs;
  defaultWorkspace?: string | null;
  config?: Config;
  configMissing?: boolean;
  createTokenStoreThrow?: () => unknown;
}

function makeEffects(opts: MakeEffectsOpts): Effects {
  const cfg = opts.config ?? baseConfig;
  return {
    configDir: opts.configDir,
    env: {},
    loadConfig: async () => cfg,
    getDefaultWorkspace: async () => opts.defaultWorkspace ?? cfg.default_workspace,
    createTokenStore: opts.createTokenStoreThrow
      ? () => {
          // biome-ignore lint/style/noNonNullAssertion: ternary above
          throw opts.createTokenStoreThrow!();
        }
      : () => opts.store,
    createSlackClient: (team_id, token) => {
      const client = new SlackClient({ team_id, token });
      const api = opts.api ?? {};
      if (api.usersLookupByEmail !== undefined) {
        Object.defineProperty(client, "usersLookupByEmail", {
          value: api.usersLookupByEmail,
        });
      }
      if (api.usersList !== undefined) {
        Object.defineProperty(client, "usersList", { value: api.usersList });
      }
      if (api.conversationsOpen !== undefined) {
        Object.defineProperty(client, "conversationsOpen", {
          value: api.conversationsOpen,
        });
      }
      if (api.chatPostMessage !== undefined) {
        const orig = api.chatPostMessage;
        Object.defineProperty(client, "chatPostMessage", {
          value: async (args: Record<string, unknown>) => {
            if (api.chatPostMessageCaptured !== undefined) {
              api.chatPostMessageCaptured.args = args;
            }
            return orig(args);
          },
        });
      }
      if (api.conversationsHistory !== undefined) {
        Object.defineProperty(client, "conversationsHistory", {
          value: api.conversationsHistory,
        });
      }
      if (api.conversationsReplies !== undefined) {
        const orig = api.conversationsReplies;
        Object.defineProperty(client, "conversationsReplies", {
          value: async (args: Record<string, unknown>) => {
            if (api.conversationsRepliesArgs !== undefined) {
              api.conversationsRepliesArgs.value = args;
            }
            return orig(args);
          },
        });
      }
      return client;
    },
    readFile: async (_p) => "",
    statSync: () => ({ isFile: () => true }),
    openDb: () => opts.db,
    stdout: opts.stdout,
    now: () => 1700000000000,
    nowSec: () => 1700000000,
  };
}

describe("handleDm", () => {
  let dir: string;
  let db: Database;
  let stdout: PassThrough;
  let store: MemoryTokenStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-dm-handler-"));
    db = openDatabase({ path: ":memory:" });
    stdout = new PassThrough();
    store = new MemoryTokenStore();
    await saveConfig(baseConfig, { configDir: dir });
    await store.set(TEAM, TOKEN_BOT);
    // post 経路は process.stdout.write を使うのでテスト時は spy に置き換え
    spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(async () => {
    db.close();
    mock.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it("(1) write 経路: Uxxx → conversations.open → chat.postMessage が Dxxx で呼ばれる", async () => {
    const captured: { args?: Record<string, unknown> } = {};
    const effects = makeEffects({
      configDir: dir,
      store,
      db,
      stdout,
      api: {
        conversationsOpen: async () => ({
          ok: true,
          channel: { id: "D0123ABCDEF" },
        }),
        chatPostMessage: async () => ({
          ok: true,
          ts: "1700000000.000100",
          channel: "D0123ABCDEF",
        }),
        chatPostMessageCaptured: captured,
      },
    });
    const ctx = makeCtx({ rest: ["U0123ABCDEF", "hi"] });
    const code = await handleDm(ctx, effects);
    expect(code).toBe(0);
    expect(captured.args?.channel).toBe("D0123ABCDEF");
    expect(captured.args?.text).toBe("hi");
  });

  it("(2) write 経路 + email: lookupByEmail → open → postMessage", async () => {
    const captured: { args?: Record<string, unknown> } = {};
    const effects = makeEffects({
      configDir: dir,
      store,
      db,
      stdout,
      api: {
        usersLookupByEmail: async () => ({
          ok: true,
          user: { id: "U0987XYZ" },
        }),
        conversationsOpen: async (args) => {
          expect((args as Record<string, unknown>).users).toBe("U0987XYZ");
          return { ok: true, channel: { id: "D0987XYZ" } };
        },
        chatPostMessage: async () => ({
          ok: true,
          ts: "1700000000.000101",
          channel: "D0987XYZ",
        }),
        chatPostMessageCaptured: captured,
      },
    });
    const ctx = makeCtx({ rest: ["alice@example.com", "hello"] });
    const code = await handleDm(ctx, effects);
    expect(code).toBe(0);
    expect(captured.args?.channel).toBe("D0987XYZ");
  });

  it("(3) read 経路: Uxxx → open → conversations.history が Dxxx で呼ばれる", async () => {
    let historyChannel: unknown;
    const effects = makeEffects({
      configDir: dir,
      store,
      db,
      stdout,
      api: {
        conversationsOpen: async () => ({
          ok: true,
          channel: { id: "D0123ABCDEF" },
        }),
        conversationsHistory: async (args) => {
          historyChannel = args.channel;
          return {
            ok: true,
            messages: [{ ts: "1700000000.000100", text: "hi", user: "U1", type: "message" }],
            response_metadata: { next_cursor: "" },
          };
        },
      },
    });
    const ctx = makeCtx({ rest: ["U0123ABCDEF", "--read"] });
    const code = await handleDm(ctx, effects);
    expect(code).toBe(0);
    expect(historyChannel).toBe("D0123ABCDEF");
  });

  it("(4) read 経路 + --thread: replies が Dxxx で呼ばれる", async () => {
    const captured: { value?: Record<string, unknown> } = {};
    const effects = makeEffects({
      configDir: dir,
      store,
      db,
      stdout,
      api: {
        conversationsOpen: async () => ({
          ok: true,
          channel: { id: "D0123ABCDEF" },
        }),
        conversationsRepliesArgs: captured,
        conversationsReplies: async () => ({
          ok: true,
          messages: [
            {
              ts: "1700000000.000100",
              text: "p",
              user: "U1",
              type: "message",
            },
          ],
          response_metadata: { next_cursor: "" },
        }),
      },
    });
    const ctx = makeCtx({
      rest: ["U0123ABCDEF", "--read", "--thread=1700000000.000100"],
    });
    const code = await handleDm(ctx, effects);
    expect(code).toBe(0);
    expect(captured.value?.channel).toBe("D0123ABCDEF");
  });

  it("(5) workspace 不在 + default なし → UserError", async () => {
    const effects = makeEffects({
      configDir: dir,
      store,
      db,
      stdout,
      defaultWorkspace: null,
    });
    const ctx = makeCtx({ workspace: null, rest: ["U0123ABCDEF", "hi"] });
    try {
      await handleDm(ctx, effects);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("--workspace");
    }
  });

  it("(6) email + missing_scope (PlatformError) + xoxb → UserError + ヒント", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "missing_scope" },
    });
    const effects = makeEffects({
      configDir: dir,
      store,
      db,
      stdout,
      api: {
        usersLookupByEmail: async () => {
          throw platformErr;
        },
      },
    });
    const ctx = makeCtx({ rest: ["alice@example.com", "hi"] });
    try {
      await handleDm(ctx, effects);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("Bot Token Scopes");
    }
  });

  it("(7) post handler から `post: ...` UserError が来た場合 dm: に再ブランド", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "channel_not_found" },
    });
    const effects = makeEffects({
      configDir: dir,
      store,
      db,
      stdout,
      api: {
        conversationsOpen: async () => ({
          ok: true,
          channel: { id: "D0123ABCDEF" },
        }),
        chatPostMessage: async () => {
          throw platformErr;
        },
      },
    });
    const ctx = makeCtx({ rest: ["U0123ABCDEF", "hi"] });
    try {
      await handleDm(ctx, effects);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg.startsWith("dm: ")).toBe(true);
      expect(msg).not.toContain("post: ");
    }
  });

  it("(8) read handler から `read: ...` TransientError が来た場合 dm: に再ブランド", async () => {
    const effects = makeEffects({
      configDir: dir,
      store,
      db,
      stdout,
      api: {
        conversationsOpen: async () => ({
          ok: true,
          channel: { id: "D0123ABCDEF" },
        }),
        conversationsHistory: async () => ({
          ok: false,
          error: "ratelimited",
        }),
      },
    });
    const ctx = makeCtx({ rest: ["U0123ABCDEF", "--read"] });
    try {
      await handleDm(ctx, effects);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      const msg = (e as TransientError).message;
      expect(msg.startsWith("dm: ")).toBe(true);
      expect(msg).not.toContain("read: ");
    }
  });

  it("(9) token 不在 → UserError", async () => {
    const emptyStore = new MemoryTokenStore();
    const effects = makeEffects({
      configDir: dir,
      store: emptyStore,
      db,
      stdout,
    });
    const ctx = makeCtx({ rest: ["U0123ABCDEF", "hi"] });
    try {
      await handleDm(ctx, effects);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("no token stored");
    }
  });

  it("(10)未登録 workspace → UserError", async () => {
    const ctx = makeCtx({ workspace: "T9UNKNOWN", rest: ["U0123ABCDEF", "hi"] });
    const effects = makeEffects({ configDir: dir, store, db, stdout });
    try {
      await handleDm(ctx, effects);
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not registered");
    }
  });
});
