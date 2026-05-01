import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { WebClient } from "@slack/web-api";
import type { Effects } from "../../../../src/cli/commands/sync/effects.ts";
import { syncHandler } from "../../../../src/cli/commands/sync/handler.ts";
import { UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { saveConfig } from "../../../../src/config/io.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

interface ApiResp {
  ok: boolean;
  channels?: Array<{ id?: string; name?: string }>;
  messages?: Array<Record<string, unknown>>;
  response_metadata?: { next_cursor?: string };
  error?: string;
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
    workspace: null,
    format: "jsonl",
    verbose: false,
    rest: [],
    logger: new StderrLogger(),
    ...overrides,
  };
}

interface TestEffectsOpts {
  configDir: string;
  store: MemoryTokenStore;
  db: Database;
  stdout: NodeJS.WritableStream;
  now?: () => number;
}

function makeEffects(opts: TestEffectsOpts): Effects {
  return {
    configDir: opts.configDir,
    env: {},
    openDb: () => opts.db,
    createTokenStore: () => opts.store,
    createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
    now: opts.now ?? (() => 1700000000),
    stdout: opts.stdout,
  };
}

const baseConfig: Config = {
  default_workspace: null,
  workspaces: {
    T01ABCDEF: { name: "Acme", default_channel: null, tokens_store: "file" },
  },
  output: { format: "jsonl", cache_window_days: 7 },
};

function readBuffer(stream: PassThrough): string {
  let s = "";
  for (let chunk: unknown = stream.read(); chunk !== null; chunk = stream.read()) {
    s += String(chunk);
  }
  return s;
}

describe("syncHandler", () => {
  let dir: string;
  let db: Database;
  let stdout: PassThrough;
  let store: MemoryTokenStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-sync-handler-"));
    db = openDatabase({ path: ":memory:" });
    stdout = new PassThrough();
    store = new MemoryTokenStore();
  });

  afterEach(async () => {
    db.close();
    mock.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it("(1) --full で mode=refresh が history API に渡る + JSONL 1 行で stdout に書かれる", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");

    const apiSpy = mockApi({
      "conversations.history": async () => ({
        ok: true,
        messages: [{ ts: "1700000000.000100", text: "hello", user: "U1", type: "message" }],
        response_metadata: { next_cursor: "" },
      }),
    });

    const ctx = makeCtx({
      workspace: "T01ABCDEF",
      rest: ["C12345678", "--full"],
    });
    const code = await syncHandler(
      ctx,
      makeEffects({ configDir: dir, store, db, stdout, now: () => 1700000010 }),
    );
    expect(code).toBe(0);

    const calls = apiSpy.mock.calls.filter((c) => c[0] === "conversations.history");
    expect(calls.length).toBe(1);
    expect((calls[0]?.[1] as { oldest?: string }).oldest).toBe("0");

    const out = readBuffer(stdout);
    const lines = out.trim().split("\n");
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0] as string);
    expect(rec.ok).toBe(true);
    expect(rec.team_id).toBe("T01ABCDEF");
    expect(rec.channel_id).toBe("C12345678");
    expect(rec.mode).toBe("refresh");
    expect(rec.upserted).toBe(1);
    expect(rec.deleted_marked).toBe(0);
    expect(rec.revived).toBe(0);
    expect(rec.last_synced_ts).toBe("1700000000.000100");
    expect(rec.fetched_at).toBe(1700000010);
  });

  it("(2) --full 無しで mode=incremental", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({
        ok: true,
        messages: [],
        response_metadata: { next_cursor: "" },
      }),
    });
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["C12345678"] });
    const code = await syncHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
    expect(code).toBe(0);
    const out = readBuffer(stdout).trim();
    const rec = JSON.parse(out);
    expect(rec.mode).toBe("incremental");
    expect(rec.upserted).toBe(0);
  });

  it("(3) not_in_channel → invite hint 付き UserError", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({ ok: false, error: "not_in_channel" }),
    });
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["C12345678"] });
    try {
      await syncHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/^sync: /);
      expect(msg).toContain("/invite");
      expect(msg).toContain("user OAuth token");
    }
  });

  it("(4) workspace 未登録 → UserError 'sync: ... is not registered'", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const ctx = makeCtx({ workspace: "T9UNKNOWN", rest: ["C12345678"] });
    try {
      await syncHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/^sync: /);
      expect(msg).toContain("is not registered");
    }
  });

  it("(5) token 不在 → UserError 'sync: no token stored'", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["C12345678"] });
    try {
      await syncHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      const msg = (err as Error).message;
      expect(msg).toMatch(/^sync: /);
      expect(msg).toContain("no token stored");
    }
  });

  it("(6) stdout の bytes が JSON.stringify(result) + 改行 に厳密一致", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({
        ok: true,
        messages: [],
        response_metadata: { next_cursor: "" },
      }),
    });
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["C12345678"] });
    const code = await syncHandler(
      ctx,
      makeEffects({ configDir: dir, store, db, stdout, now: () => 1700000050 }),
    );
    expect(code).toBe(0);
    const out = readBuffer(stdout);
    expect(out.endsWith("\n")).toBe(true);
    expect(out.split("\n").length).toBe(2); // 1 行 + 末尾改行 → split で 2 要素
    const rec = JSON.parse(out.trim());
    const expected = `${JSON.stringify(rec)}\n`;
    expect(out).toBe(expected);
  });

  it("(7) --workspace 未指定 + default 無し → UserError 'sync: --workspace=T... is required'", async () => {
    await saveConfig({ ...baseConfig, default_workspace: null }, { configDir: dir });
    const ctx = makeCtx({ workspace: null, rest: ["C12345678"] });
    try {
      await syncHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      const msg = (err as Error).message;
      expect(msg).toContain("--workspace=T... is required");
    }
  });

  it("(8) Major #1: channel_not_found 等 Slack エラー時 'sync:' プレフィックスで rethrow (read: 漏れ無し)", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({ ok: false, error: "channel_not_found" }),
    });
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["C12345678"] });
    try {
      await syncHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      const msg = (err as Error).message;
      expect(msg.startsWith("sync: ")).toBe(true);
      expect(msg.startsWith("read: ")).toBe(false);
      expect(msg).toContain("channel_not_found");
    }
  });
});
