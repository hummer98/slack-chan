import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { PassThrough } from "node:stream";
import { ErrorCode, WebClient } from "@slack/web-api";
import type { Effects } from "../../../../src/cli/commands/search/effects.ts";
import { searchHandler } from "../../../../src/cli/commands/search/handler.ts";
import { TransientError, UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import { openDatabase } from "../../../../src/storage/db.ts";
import type { MessageUpsertInput } from "../../../../src/storage/types.ts";

const TEAM = "T01ABCDEF";
const TOKEN_USER = "xoxp-test-1234567890abcd";
const TOKEN_BOT = "xoxb-test-1234567890abcd";

interface ApiResp {
  ok?: boolean;
  channels?: Array<Record<string, unknown>>;
  members?: Array<Record<string, unknown>>;
  response_metadata?: { next_cursor?: string };
  messages?: Record<string, unknown>;
  error?: string;
  user?: Record<string, unknown>;
}

type ApiHandlers = Partial<Record<string, (params: Record<string, unknown>) => Promise<ApiResp>>>;

function mockApi(handlers: ApiHandlers) {
  const proto = WebClient.prototype as unknown as {
    apiCall: (method: string, params?: unknown) => Promise<unknown>;
  };
  return spyOn(proto, "apiCall").mockImplementation(async (method, params) => {
    const h = handlers[method];
    if (h === undefined) throw new Error(`unhandled api method: ${method}`);
    return h((params ?? {}) as Record<string, unknown>);
  });
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

function baseConfig(): Config {
  return {
    default_workspace: null,
    workspaces: {
      [TEAM]: { name: "Acme", default_channel: null, tokens_store: "file" },
    },
    output: { format: "jsonl", cache_window_days: 7 },
  };
}

interface MakeEffectsOpts {
  config?: Config;
  defaultWorkspace?: string | null;
  store?: MemoryTokenStore;
  db?: Database;
  stdout?: NodeJS.WritableStream;
  now?: () => number;
  storeMissing?: boolean;
  token?: string;
}

function makeEffects(opts: MakeEffectsOpts = {}): {
  effects: Effects;
  store: MemoryTokenStore;
  db: Database;
  stdout: PassThrough;
} {
  const cfg = opts.config ?? baseConfig();
  const store = opts.store ?? new MemoryTokenStore();
  const db = opts.db ?? openDatabase({ path: ":memory:" });
  const stdout = (opts.stdout ?? new PassThrough()) as PassThrough;
  if (!opts.storeMissing) {
    void store.set(TEAM, opts.token ?? TOKEN_USER);
  }
  const effects: Effects = {
    configDir: "/tmp/search-test",
    env: {},
    loadConfig: async () => cfg,
    getDefaultWorkspace: async () => opts.defaultWorkspace ?? cfg.default_workspace,
    createTokenStore: () => store,
    createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
    openDb: () => db,
    now: opts.now ?? (() => 1700000000),
    stdout,
  };
  return { effects, store, db, stdout };
}

function readBuffer(stream: PassThrough): string {
  let s = "";
  for (let chunk: unknown = stream.read(); chunk !== null; chunk = stream.read()) {
    s += String(chunk);
  }
  return s;
}

function seed(db: Database, overrides: Partial<MessageUpsertInput> & { ts: string }): void {
  messagesDao.upsert(db, {
    team_id: TEAM,
    channel_id: "C12345678",
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "seed-text",
    edited_ts: null,
    raw_json: "{}",
    fetched_at: 1700000000,
    ...overrides,
  });
}

describe("searchHandler", () => {
  let dbs: Database[] = [];

  beforeEach(() => {
    dbs = [];
  });

  afterEach(() => {
    mock.restore();
    for (const d of dbs) d.close();
  });

  function trackDb(db: Database): Database {
    dbs.push(db);
    return db;
  }

  it("(1) existing cache only with --cached-only: Slack not called, JSONL output", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    seed(db, { ts: "1700000001.000000", text: "hello world" });
    seed(db, { ts: "1700000002.000000", text: "hello kitty" });

    const apiSpy = spyOn(
      WebClient.prototype as unknown as {
        apiCall: (method: string, params?: unknown) => Promise<unknown>;
      },
      "apiCall",
    ).mockImplementation(async () => {
      throw new Error("apiCall must not be called for --cached-only");
    });

    const { effects, stdout } = makeEffects({ db });
    const code = await searchHandler(makeCtx({ rest: ["hello", "--cached-only"] }), effects);
    expect(code).toBe(0);
    expect(apiSpy.mock.calls.length).toBe(0);
    const out = readBuffer(stdout);
    expect(out).toContain('"text":"hello world"');
    expect(out).toContain('"text":"hello kitty"');
    expect(out).toContain('"source":"cache"');
  });

  it("(2) xoxb token: warn + cached-only equivalent (no Slack call)", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    seed(db, { ts: "1700000001.000000", text: "hello bot world" });

    const apiSpy = spyOn(
      WebClient.prototype as unknown as {
        apiCall: (method: string, params?: unknown) => Promise<unknown>;
      },
      "apiCall",
    ).mockImplementation(async () => {
      throw new Error("apiCall must not be called for xoxb token");
    });

    const warns: string[] = [];
    const ctx = makeCtx({
      rest: ["hello"],
      logger: {
        debug: () => {},
        info: () => {},
        warn: (...args: unknown[]) => {
          warns.push(args.map(String).join(" "));
        },
        error: () => {},
        setLevel: () => {},
      },
    });
    const { effects, stdout } = makeEffects({ db, token: TOKEN_BOT });
    const code = await searchHandler(ctx, effects);
    expect(code).toBe(0);
    expect(apiSpy.mock.calls.length).toBe(0);
    const joined = warns.join("\n");
    expect(joined).toContain("xoxb");
    const out = readBuffer(stdout);
    expect(out).toContain('"text":"hello bot world"');
  });

  it("(3) xoxp + Slack returns matches: merged result with cache + remote", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    seed(db, { ts: "1700000001.000000", text: "hello cache one" });
    seed(db, { ts: "1700000002.000000", text: "hello cache two" });

    mockApi({
      "search.messages": async () => ({
        ok: true,
        messages: {
          total: 2,
          pagination: { page: 1, page_count: 1 },
          matches: [
            {
              channel: { id: "C12345678", name: "general" },
              user: "U2",
              ts: "1700000010.000000",
              text: "remote one",
              permalink: "https://slack/p1",
            },
            {
              channel: { id: "C12345678", name: "general" },
              user: "U2",
              ts: "1700000011.000000",
              text: "remote two",
              permalink: "https://slack/p2",
            },
          ],
        },
      }),
    });

    const { effects, stdout } = makeEffects({ db });
    const code = await searchHandler(makeCtx({ rest: ["hello"] }), effects);
    expect(code).toBe(0);
    const out = readBuffer(stdout).trim();
    const lines = out.split("\n");
    expect(lines.length).toBe(4);
    expect(out).toContain("hello cache one");
    expect(out).toContain('"source":"remote"');
    expect(out).toContain("https://slack/p1");
  });

  it("(4) xoxp + dup ts: same (channel,ts) merged with source=both", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    seed(db, { ts: "1700000005.000000", text: "shared message" });

    mockApi({
      "search.messages": async () => ({
        ok: true,
        messages: {
          total: 1,
          pagination: { page: 1, page_count: 1 },
          matches: [
            {
              channel: { id: "C12345678", name: "general" },
              user: "U1",
              ts: "1700000005.000000",
              text: "shared message remote",
              permalink: "https://slack/perm",
            },
          ],
        },
      }),
    });
    const { effects, stdout } = makeEffects({ db });
    const code = await searchHandler(makeCtx({ rest: ["shared"] }), effects);
    expect(code).toBe(0);
    const out = readBuffer(stdout).trim();
    const lines = out.split("\n");
    expect(lines.length).toBe(1);
    expect(out).toContain('"source":"both"');
    expect(out).toContain('"permalink":"https://slack/perm"');
    expect(out).toContain('"text":"shared message"');
  });

  it("(5) --in resolves channel name to id and applies to FTS + Slack query", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    seed(db, { channel_id: "C111", ts: "1700000001.000000", text: "scoped hit" });
    seed(db, { channel_id: "C222", ts: "1700000002.000000", text: "scoped hit different" });

    const apiCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
    spyOn(
      WebClient.prototype as unknown as {
        apiCall: (method: string, params?: unknown) => Promise<unknown>;
      },
      "apiCall",
    ).mockImplementation(async (method: unknown, params: unknown) => {
      const m = method as string;
      const p = (params ?? {}) as Record<string, unknown>;
      apiCalls.push({ method: m, params: p });
      if (m === "conversations.list") {
        return {
          ok: true,
          channels: [{ id: "C111", name: "ops" }],
        };
      }
      if (m === "search.messages") {
        return {
          ok: true,
          messages: { total: 0, pagination: { page: 1, page_count: 1 }, matches: [] },
        };
      }
      throw new Error(`unhandled ${m}`);
    });
    const { effects, stdout } = makeEffects({ db });
    const code = await searchHandler(makeCtx({ rest: ["scoped", "--in=ops"] }), effects);
    expect(code).toBe(0);
    const out = readBuffer(stdout);
    // FTS で channel C111 のみがヒット
    expect(out).toContain('"channel_id":"C111"');
    expect(out).not.toContain('"channel_id":"C222"');
    // Slack 側 query に in:#ops が入る
    const sm = apiCalls.find((c) => c.method === "search.messages");
    expect(sm).toBeDefined();
    expect(String(sm?.params.query)).toContain("in:#ops");
  });

  it("(6) --from resolves @name to user_id and applies to query", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    seed(db, { user_id: "U_ALICE", ts: "1700000001.000000", text: "alice msg" });
    seed(db, { user_id: "U_BOB", ts: "1700000002.000000", text: "bob msg" });

    const apiCalls: Array<{ method: string; params: Record<string, unknown> }> = [];
    spyOn(
      WebClient.prototype as unknown as {
        apiCall: (method: string, params?: unknown) => Promise<unknown>;
      },
      "apiCall",
    ).mockImplementation(async (method: unknown, params: unknown) => {
      const m = method as string;
      const p = (params ?? {}) as Record<string, unknown>;
      apiCalls.push({ method: m, params: p });
      if (m === "users.list") {
        return {
          ok: true,
          members: [
            { id: "U_ALICE", name: "alice", profile: {} },
            { id: "U_BOB", name: "bob", profile: {} },
          ],
          response_metadata: {},
        };
      }
      if (m === "search.messages") {
        return {
          ok: true,
          messages: { total: 0, pagination: { page: 1, page_count: 1 }, matches: [] },
        };
      }
      throw new Error(`unhandled ${m}`);
    });
    const { effects, stdout } = makeEffects({ db });
    const code = await searchHandler(makeCtx({ rest: ["msg", "--from=@alice"] }), effects);
    expect(code).toBe(0);
    const out = readBuffer(stdout);
    expect(out).toContain('"user_id":"U_ALICE"');
    expect(out).not.toContain('"user_id":"U_BOB"');
    const sm = apiCalls.find((c) => c.method === "search.messages");
    expect(sm).toBeDefined();
    expect(String(sm?.params.query)).toContain("from:@alice");
  });

  it("(7) empty result: exit 0, stdout empty", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    mockApi({
      "search.messages": async () => ({
        ok: true,
        messages: { total: 0, pagination: { page: 1, page_count: 1 }, matches: [] },
      }),
    });
    const { effects, stdout } = makeEffects({ db });
    const code = await searchHandler(makeCtx({ rest: ["nothing"] }), effects);
    expect(code).toBe(0);
    const out = readBuffer(stdout);
    expect(out).toBe("");
  });

  it("(8) Slack invalid_auth -> UserError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const platformErr = Object.assign(new Error("platform"), {
      code: ErrorCode.PlatformError,
      data: { error: "invalid_auth" },
    });
    mockApi({
      "search.messages": async () => {
        throw platformErr;
      },
    });
    const { effects } = makeEffects({ db });
    await expect(searchHandler(makeCtx({ rest: ["hello"] }), effects)).rejects.toBeInstanceOf(
      UserError,
    );
  });

  it("(9) Slack ratelimited -> TransientError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const rateLimitErr = Object.assign(new Error("rate"), {
      code: ErrorCode.RateLimitedError,
      retryAfter: 30,
    });
    mockApi({
      "search.messages": async () => {
        throw rateLimitErr;
      },
    });
    const { effects } = makeEffects({ db });
    await expect(searchHandler(makeCtx({ rest: ["hello"] }), effects)).rejects.toBeInstanceOf(
      TransientError,
    );
  });

  it("(10) not_allowed_token_type -> exit 0 + warn + cache only output", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    seed(db, { ts: "1700000001.000000", text: "hello cache" });
    mockApi({
      "search.messages": async () => ({ ok: false, error: "not_allowed_token_type" }),
    });
    const warns: string[] = [];
    const ctx = makeCtx({
      rest: ["hello"],
      logger: {
        debug: () => {},
        info: () => {},
        warn: (...args: unknown[]) => {
          warns.push(args.map(String).join(" "));
        },
        error: () => {},
        setLevel: () => {},
      },
    });
    const { effects, stdout } = makeEffects({ db });
    const code = await searchHandler(ctx, effects);
    expect(code).toBe(0);
    expect(warns.join("\n")).toContain("does not allow it");
    const out = readBuffer(stdout);
    expect(out).toContain('"text":"hello cache"');
    expect(out).toContain('"source":"cache"');
  });

  it("(11) workspace not registered -> UserError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const cfg = baseConfig();
    cfg.workspaces = {};
    const { effects } = makeEffects({ db, config: cfg });
    await expect(searchHandler(makeCtx({ rest: ["hello"] }), effects)).rejects.toBeInstanceOf(
      UserError,
    );
  });

  it("(12) no workspace specified, no default -> UserError", async () => {
    const db = trackDb(openDatabase({ path: ":memory:" }));
    const { effects } = makeEffects({ db, defaultWorkspace: null });
    await expect(
      searchHandler(makeCtx({ workspace: null, rest: ["hello"] }), effects),
    ).rejects.toBeInstanceOf(UserError);
  });
});
