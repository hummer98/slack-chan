import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ErrorCode } from "@slack/web-api";
import type { Effects } from "../../../../src/cli/commands/user/effects.ts";
import { handleUser } from "../../../../src/cli/commands/user/handler.ts";
import { InternalError, TransientError, UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

const TOKEN = "xoxb-test-1234567890abcd";
const TEAM = "T123";

function baseConfig(): Config {
  return {
    default_workspace: null,
    workspaces: {
      T123: { name: "Acme", default_channel: null, tokens_store: "file" },
    },
    output: { format: "jsonl", cache_window_days: 7 },
  };
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

interface UsersInfoStub {
  mode: "ok" | "throw";
  response?: unknown;
  error?: unknown;
}
interface UsersLookupByEmailStub {
  mode: "ok" | "throw";
  response?: unknown;
  error?: unknown;
}
interface UsersListStub {
  pages: { members?: unknown[]; response_metadata?: { next_cursor?: string } }[];
}

interface MakeEffectsOpts {
  config?: Config;
  defaultWorkspace?: string | null;
  store?: MemoryTokenStore;
  storeMissing?: boolean;
  createTokenStoreThrow?: () => unknown;
  usersInfo?: UsersInfoStub;
  usersLookupByEmail?: UsersLookupByEmailStub;
  usersList?: UsersListStub;
  db?: Database;
}

function makeEffects(opts: MakeEffectsOpts = {}): {
  effects: Effects;
  store: MemoryTokenStore;
  db: Database;
} {
  const cfg: Config = opts.config ?? baseConfig();
  const store = opts.store ?? new MemoryTokenStore();
  const db = opts.db ?? openDatabase({ path: ":memory:" });

  const effects: Effects = {
    configDir: "/tmp/user-test",
    env: {},
    loadConfig: async () => cfg,
    getDefaultWorkspace: async () => opts.defaultWorkspace ?? cfg.default_workspace,
    createTokenStore: opts.createTokenStoreThrow
      ? () => {
          // biome-ignore lint/style/noNonNullAssertion: guarded by the ternary above
          throw opts.createTokenStoreThrow!();
        }
      : () => store,
    createSlackClient: (team_id, token) => {
      const client = new SlackClient({ team_id, token });
      Object.defineProperty(client, "usersInfo", {
        value: async (_args: { user: string }) => {
          const stub = opts.usersInfo;
          if (stub === undefined) throw new Error("usersInfo not stubbed");
          if (stub.mode === "throw") throw stub.error;
          return stub.response;
        },
      });
      Object.defineProperty(client, "usersLookupByEmail", {
        value: async (_args: { email: string }) => {
          const stub = opts.usersLookupByEmail;
          if (stub === undefined) throw new Error("usersLookupByEmail not stubbed");
          if (stub.mode === "throw") throw stub.error;
          return stub.response;
        },
      });
      const listCalls: { args: unknown }[] = [];
      Object.defineProperty(client, "usersList", {
        value: async (args: { limit?: number; cursor?: string }) => {
          listCalls.push({ args });
          const stub = opts.usersList;
          if (stub === undefined) return { members: [], response_metadata: {} };
          const idx = listCalls.length - 1;
          return stub.pages[idx] ?? { members: [], response_metadata: {} };
        },
      });
      return client;
    },
    openDb: () => db,
    now: () => 1_700_000_000_000,
  };

  if (!opts.storeMissing) {
    void store.set(TEAM, TOKEN);
  }

  return { effects, store, db };
}

describe("handleUser", () => {
  let stdoutSpy: ReturnType<typeof spyOn> | null = null;
  let dbs: Database[] = [];

  beforeEach(() => {
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    dbs = [];
  });

  afterEach(() => {
    mock.restore();
    stdoutSpy = null;
    for (const d of dbs) d.close();
  });

  function stdout(): string {
    return stdoutSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }

  function trackDb(db: Database): Database {
    dbs.push(db);
    return db;
  }

  // ---------- 正常系 ----------

  it("(1) id mode 正常: stdout に jsonl 1 行", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const { effects } = makeEffects({
      db,
      usersInfo: {
        mode: "ok",
        response: {
          ok: true,
          user: { id: "U01ABCDEF", name: "alice", profile: { email: "alice@x.com" } },
        },
      },
    });
    const code = await handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects);
    expect(code).toBe(0);
    const out = stdout();
    expect(out).toContain('"ok":true');
    expect(out).toContain('"user_id":"U01ABCDEF"');
    expect(out).toContain('"name":"alice"');
    expect(out).toContain('"email":"alice@x.com"');
    expect(out.endsWith("\n")).toBe(true);
  });

  it("(2) --workspace 指定 + 正常", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const { effects } = makeEffects({
      db,
      usersInfo: {
        mode: "ok",
        response: { ok: true, user: { id: "U01ABCDEF", name: "alice" } },
      },
    });
    const code = await handleUser(makeCtx({ workspace: "T123", rest: ["U01ABCDEF"] }), effects);
    expect(code).toBe(0);
  });

  // ---------- workspace / token エラー ----------

  it("(3) --workspace 不正形式 → UserError 'must match'", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const { effects } = makeEffects({ db });
    try {
      await handleUser(makeCtx({ workspace: "bad-team", rest: ["U01ABCDEF"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("must match");
    }
  });

  it("(4) workspace 未登録 → UserError 'not registered'", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const cfg: Config = {
      default_workspace: null,
      workspaces: {},
      output: { format: "jsonl", cache_window_days: 7 },
    };
    const { effects } = makeEffects({ db, config: cfg });
    try {
      await handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not registered");
    }
  });

  it("(5) token 未登録 → UserError 'no token stored'", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const store = new MemoryTokenStore();
    const { effects } = makeEffects({ db, store, storeMissing: true });
    try {
      await handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("no token stored");
    }
  });

  it("(6) createTokenStore throw (keychain on Linux) → UserError 'cannot use keychain'", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T123: { name: "Acme", default_channel: null, tokens_store: "keychain" },
      },
      output: { format: "jsonl", cache_window_days: 7 },
    };
    const { effects } = makeEffects({
      db,
      config: cfg,
      createTokenStoreThrow: () =>
        new Error('Keychain backend is macOS-only. Use TokensStore="file" or run on macOS.'),
    });
    try {
      await handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg).toContain("cannot use keychain token backend on this platform");
      expect(msg).toContain("config tokens-store file");
    }
  });

  // ---------- Slack API エラー分類 ----------

  it("(7) classifySlackError: rate limit (RateLimitedError) → TransientError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const rateLimitErr = Object.assign(new Error("rate limited"), {
      code: ErrorCode.RateLimitedError,
      retryAfter: 30,
    });
    const { effects } = makeEffects({
      db,
      usersInfo: { mode: "throw", error: rateLimitErr },
    });
    try {
      await handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("rate limited");
    }
  });

  it("(8) classifySlackError: user_not_found → UserError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "user_not_found" },
    });
    const { effects } = makeEffects({
      db,
      usersInfo: { mode: "throw", error: platformErr },
    });
    await expect(handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects)).rejects.toBeInstanceOf(
      UserError,
    );
  });

  it("(9) classifySlackError: invalid_auth → UserError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "invalid_auth" },
    });
    const { effects } = makeEffects({
      db,
      usersInfo: { mode: "throw", error: platformErr },
    });
    await expect(handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects)).rejects.toBeInstanceOf(
      UserError,
    );
  });

  it("(10) classifySlackError: HTTP 503 → TransientError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const httpErr = Object.assign(new Error("http"), {
      code: ErrorCode.HTTPError,
      statusCode: 503,
    });
    const { effects } = makeEffects({
      db,
      usersInfo: { mode: "throw", error: httpErr },
    });
    try {
      await handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("503");
    }
  });

  it("(11) classifySlackError: ECONNREFUSED → TransientError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const reqErr = Object.assign(new Error("request failed"), {
      code: ErrorCode.RequestError,
      original: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 1.2.3.4:443" },
    });
    const { effects } = makeEffects({
      db,
      usersInfo: { mode: "throw", error: reqErr },
    });
    try {
      await handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("network ECONNREFUSED");
    }
  });

  it("(12) classifySlackError: 未知 PlatformError → InternalError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "future_unknown_error" },
    });
    const { effects } = makeEffects({
      db,
      usersInfo: { mode: "throw", error: platformErr },
    });
    await expect(handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects)).rejects.toBeInstanceOf(
      InternalError,
    );
  });

  it("(13) usersInfo ok=false (user 不在) → UserError 'returned no user'", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const { effects } = makeEffects({
      db,
      usersInfo: { mode: "ok", response: { ok: false } },
    });
    try {
      await handleUser(makeCtx({ rest: ["U01ABCDEF"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("returned no user");
    }
  });

  it("(14) format = human → JSON.stringify 整形済が出る (HumanFormatter は dim ANSI 付き JSON)", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const { effects } = makeEffects({
      db,
      usersInfo: {
        mode: "ok",
        response: { ok: true, user: { id: "U01ABCDEF", name: "alice" } },
      },
    });
    const code = await handleUser(makeCtx({ format: "human", rest: ["U01ABCDEF"] }), effects);
    expect(code).toBe(0);
    expect(stdout()).toContain('"user_id"');
    expect(stdout()).toContain("U01ABCDEF");
  });

  // ---------- @name 経路 ----------

  it("(15) @name + DB miss → users.list 経由で resolve, upsert される", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const { effects } = makeEffects({
      db,
      usersList: {
        pages: [
          {
            members: [
              { id: "U10", name: "alice" },
              { id: "U11", name: "bob" },
            ],
            response_metadata: { next_cursor: "" },
          },
        ],
      },
    });
    const code = await handleUser(makeCtx({ rest: ["@bob"] }), effects);
    expect(code).toBe(0);
    expect(stdout()).toContain('"user_id":"U11"');
    expect(stdout()).toContain('"name":"bob"');
  });
});
