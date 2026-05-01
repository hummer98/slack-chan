import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { WebClient } from "@slack/web-api";
import type { Effects } from "../../../../src/cli/commands/read/effects.ts";
import { readHandler } from "../../../../src/cli/commands/read/handler.ts";
import { TransientError, UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { saveConfig } from "../../../../src/config/io.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import { openDatabase } from "../../../../src/storage/db.ts";
import type { MessageUpsertInput } from "../../../../src/storage/types.ts";

interface ApiResp {
  ok: boolean;
  channels?: Array<{ id?: string; name?: string; name_normalized?: string }>;
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

function seedMsg(db: Database, ts: string, overrides: Partial<MessageUpsertInput> = {}): void {
  messagesDao.upsert(db, {
    team_id: "T01ABCDEF",
    channel_id: "C12345678",
    ts,
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "seed",
    edited_ts: null,
    raw_json: "{}",
    fetched_at: 1700000000,
    ...overrides,
  });
}

describe("readHandler", () => {
  let dir: string;
  let db: Database;
  let stdout: PassThrough;
  let store: MemoryTokenStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-read-handler-"));
    db = openDatabase({ path: ":memory:" });
    stdout = new PassThrough();
    store = new MemoryTokenStore();
  });

  afterEach(async () => {
    db.close();
    mock.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it("(1) 正常系: --workspace 指定 / cache 空 → list + history → jsonl 出力", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");

    const apiSpy = mockApi({
      "conversations.list": async () => ({
        ok: true,
        channels: [{ id: "C12345678", name: "general" }],
      }),
      "conversations.history": async () => ({
        ok: true,
        messages: [{ ts: "1700000000.000100", text: "hello", user: "U1", type: "message" }],
        response_metadata: { next_cursor: "" },
      }),
    });

    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["general"] });
    const code = await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
    expect(code).toBe(0);
    expect(apiSpy.mock.calls.some((c) => c[0] === "conversations.list")).toBe(true);
    expect(apiSpy.mock.calls.some((c) => c[0] === "conversations.history")).toBe(true);

    const out = readBuffer(stdout);
    expect(out).toContain('"ts":"1700000000.000100"');
    expect(out).toContain('"text":"hello"');
  });

  it("(2) default workspace: ctx.workspace 無し / config に default あり → 解決して通る", async () => {
    await saveConfig({ ...baseConfig, default_workspace: "T01ABCDEF" }, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({
        ok: true,
        messages: [],
        response_metadata: { next_cursor: "" },
      }),
    });
    const ctx = makeCtx({ workspace: null, rest: ["C12345678"] });
    const code = await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
    expect(code).toBe(0);
  });

  it("(3) default workspace 不在: --workspace 無し → UserError '--workspace=T... is required'", async () => {
    await saveConfig({ ...baseConfig, default_workspace: null }, { configDir: dir });
    const ctx = makeCtx({ workspace: null, rest: ["foo"] });
    try {
      await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("--workspace=T... is required");
    }
  });

  it("(4) 未登録 workspace → UserError 'is not registered'", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const ctx = makeCtx({ workspace: "T9UNKNOWN", rest: ["foo"] });
    try {
      await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("is not registered");
    }
  });

  it("(5) token 不在 → UserError 'no token stored'", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["foo"] });
    try {
      await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("no token stored");
    }
  });

  it("(6) --thread mode: replies fetch + thread output", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    const PARENT = "1700000000.000100";
    const REPLY = "1700000000.000200";
    mockApi({
      "conversations.replies": async () => ({
        ok: true,
        messages: [
          { ts: PARENT, text: "parent", user: "U1", type: "message" },
          { ts: REPLY, thread_ts: PARENT, text: "r1", user: "U2", type: "message" },
        ],
        response_metadata: { next_cursor: "" },
      }),
    });
    const ctx = makeCtx({
      workspace: "T01ABCDEF",
      rest: ["C12345678", `--thread=${PARENT}`],
    });
    const code = await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
    expect(code).toBe(0);
    const out = readBuffer(stdout);
    expect(out).toContain('"text":"parent"');
    expect(out).toContain('"text":"r1"');
  });

  it("(7) --limit / --since: cache に 200 件積み → --limit=5 --since=1h で出力 5 件以下 / since 範囲", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    // cache に 200 件 seed (古→新)
    const fakeNow = 1700100000;
    for (let i = 0; i < 200; i++) {
      const ts = `${1700000000 + i * 60}.000000`;
      seedMsg(db, ts, { text: `m${i}`, fetched_at: fakeNow });
    }
    mockApi({
      "conversations.history": async () => ({
        ok: true,
        messages: [],
        response_metadata: { next_cursor: "" },
      }),
    });
    const ctx = makeCtx({
      workspace: "T01ABCDEF",
      rest: ["C12345678", "--limit=5", "--since=1h"],
    });
    const code = await readHandler(
      ctx,
      makeEffects({ configDir: dir, store, db, stdout, now: () => fakeNow }),
    );
    expect(code).toBe(0);
    const out = readBuffer(stdout).trim();
    const lines = out.length === 0 ? [] : out.split("\n");
    expect(lines.length).toBeLessThanOrEqual(5);
    const since_ts_num = fakeNow - 3600;
    for (const line of lines) {
      const rec = JSON.parse(line) as { ts: string };
      expect(Number.parseFloat(rec.ts)).toBeGreaterThanOrEqual(since_ts_num);
    }
  });

  it("(8) stdout は effects.stdout 経由で書かれる (process.stdout には流れない)", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({
        ok: true,
        messages: [{ ts: "1700000000.000100", text: "x", user: "U1", type: "message" }],
        response_metadata: { next_cursor: "" },
      }),
    });
    const stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["C12345678"] });
    await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
    const out = readBuffer(stdout);
    expect(out).toContain('"text":"x"');
    // ── effects.stdout 経由 → process.stdout.write は payload を受け取らない
    const payloadCalls = stdoutSpy.mock.calls.filter((c) => String(c[0]).includes('"text":"x"'));
    expect(payloadCalls.length).toBe(0);
  });

  it("(9) --human format: タイムライン整形 (ANSI on)", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({
        ok: true,
        messages: [{ ts: "1700000000.000100", text: "hello", user: "U1", type: "message" }],
        response_metadata: { next_cursor: "" },
      }),
    });
    const prevTty = (process.stdout as { isTTY?: boolean }).isTTY;
    const prevNo = process.env.NO_COLOR;
    const prevSlackNo = process.env.SLACK_CHAN_NO_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.SLACK_CHAN_NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const ctx = makeCtx({
        workspace: "T01ABCDEF",
        format: "human",
        rest: ["C12345678"],
      });
      const code = await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      expect(code).toBe(0);
      const out = readBuffer(stdout);
      // タイムライン: 本文は ASCII 化された後に出る (`hello` という文字列を含む)
      expect(out).toContain("hello");
      // 本文行は 2 space indent
      expect(out).toMatch(/\n {2}hello/);
      // JSON pretty 表示（旧仕様）の `"text":` は出ない
      expect(out).not.toContain('"text":');
      // タイムスタンプは dim, channel は cyan, user は green で装飾される
      const ESC = String.fromCharCode(0x1b);
      expect(out.includes(`${ESC}[2m`)).toBe(true); // dim (timestamp)
      expect(out.includes(`${ESC}[36m`)).toBe(true); // cyan (channel)
      expect(out.includes(`${ESC}[32m`)).toBe(true); // green (user)
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: prevTty, configurable: true });
      if (prevNo !== undefined) process.env.NO_COLOR = prevNo;
      if (prevSlackNo !== undefined) process.env.SLACK_CHAN_NO_COLOR = prevSlackNo;
    }
  });

  it("(9b) --human format: NO_COLOR 環境では ANSI escape が出ない", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({
        ok: true,
        messages: [{ ts: "1700000000.000100", text: "hello", user: "U1", type: "message" }],
        response_metadata: { next_cursor: "" },
      }),
    });
    const prevTty = (process.stdout as { isTTY?: boolean }).isTTY;
    const prevNo = process.env.NO_COLOR;
    process.env.NO_COLOR = "1";
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const ctx = makeCtx({
        workspace: "T01ABCDEF",
        format: "human",
        rest: ["C12345678"],
      });
      const code = await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      expect(code).toBe(0);
      const out = readBuffer(stdout);
      const ESC = String.fromCharCode(0x1b);
      expect(out.includes(`${ESC}[`)).toBe(false);
      expect(out).toContain("hello");
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: prevTty, configurable: true });
      if (prevNo === undefined) delete process.env.NO_COLOR;
      else process.env.NO_COLOR = prevNo;
    }
  });

  it("(10) M5: history が not_in_channel → UserError stderr に '/invite' と 'user OAuth token' が含まれる", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({ ok: false, error: "not_in_channel" }),
    });
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["C12345678"] });
    try {
      await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      const msg = (err as Error).message;
      expect(msg).toContain("/invite");
      expect(msg).toContain("user OAuth token");
    }
  });

  it("(extra) Slack ratelimited → TransientError は handler を素通り", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await store.set("T01ABCDEF", "xoxb-test");
    mockApi({
      "conversations.history": async () => ({ ok: false, error: "ratelimited" }),
    });
    const ctx = makeCtx({ workspace: "T01ABCDEF", rest: ["C12345678"] });
    try {
      await readHandler(ctx, makeEffects({ configDir: dir, store, db, stdout }));
      throw new Error("expected TransientError");
    } catch (err) {
      expect(err).toBeInstanceOf(TransientError);
    }
  });
});
