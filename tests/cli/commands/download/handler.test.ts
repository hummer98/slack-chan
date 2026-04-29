import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ErrorCode } from "@slack/web-api";
import type {
  DownloadResponse,
  Effects,
  FileStat,
} from "../../../../src/cli/commands/download/effects.ts";
import { handleDownload } from "../../../../src/cli/commands/download/handler.ts";
import { TransientError, UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import type { Config } from "../../../../src/config/types.ts";
import { type Logger, StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as filesDao from "../../../../src/storage/dao/files.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import { openDatabase } from "../../../../src/storage/db.ts";
import type { FileRow, MessageUpsertInput } from "../../../../src/storage/types.ts";

const TOKEN = "xoxb-test-1234567890abcd";
const TS = "1700000000.001000";

function baseConfig(): Config {
  return {
    default_workspace: null,
    workspaces: {
      T123: { name: "Acme", default_channel: null, tokens_store: "file" },
    },
    output: { format: "jsonl", cache_window_days: 7 },
  };
}

class CapturingLogger implements Logger {
  warns: string[] = [];
  setLevel(): void {}
  debug(): void {}
  info(): void {}
  warn(msg: string): void {
    this.warns.push(msg);
  }
  error(): void {}
}

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspace: "T123",
    format: "jsonl",
    verbose: false,
    rest: [],
    logger: new StderrLogger(),
    ...overrides,
  };
}

function makeMessageRow(overrides: Partial<MessageUpsertInput> = {}): MessageUpsertInput {
  return {
    team_id: "T123",
    channel_id: "C0123ABCDEF",
    ts: TS,
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "hello",
    edited_ts: null,
    raw_json: '{"ts":"1700000000.001000","text":"hello"}',
    fetched_at: 1700000050,
    ...overrides,
  };
}

function makeFileRow(overrides: Partial<FileRow> = {}): FileRow {
  return {
    team_id: "T123",
    file_id: "F555",
    channel_id: "C0123ABCDEF",
    ts: TS,
    name: "diagram.png",
    mimetype: "image/png",
    size: 100,
    url_private: "https://files.slack.com/files-pri/T123-F555/diagram.png",
    local_path: null,
    downloaded_at: null,
    raw_json: '{"id":"F555","name":"diagram.png"}',
    ...overrides,
  };
}

interface ConvHistoryStub {
  mode: "ok" | "throw";
  capturedArgs?: Record<string, unknown>;
  response?: { messages?: unknown[] };
  error?: unknown;
}

interface ConvListStub {
  pages: { channels?: { id: string; name?: string }[] }[];
}

interface FetchFileStub {
  responses: (DownloadResponse | (() => Promise<DownloadResponse>) | Error)[];
  calls: { url: string; token: string }[];
  index: number;
}

interface MakeEffectsOpts {
  config?: Config;
  defaultWorkspace?: string | null;
  store?: MemoryTokenStore;
  storeMissing?: boolean;
  createTokenStoreThrow?: () => unknown;
  // pre-populate DB with these messages / files before the handler runs
  seedMessages?: MessageUpsertInput[];
  seedFiles?: FileRow[];
  conversationsList?: ConvListStub;
  conversationsHistory?: ConvHistoryStub;
  fetchFile?: FetchFileStub;
  // path → bytes; updated by writeBodyToFile, read by statSync
  fs?: Map<string, Uint8Array>;
  // mkdir overrides
  mkdirThrow?: NodeJS.ErrnoException;
  // writeBodyToFile override (for ENOSPC test etc.)
  writeBodyToFileThrow?: NodeJS.ErrnoException;
}

interface MakeEffectsBundle {
  effects: Effects;
  store: MemoryTokenStore;
  db: Database;
  fs: Map<string, Uint8Array>;
  fetchStub: FetchFileStub;
  historyStub: ConvHistoryStub;
}

function makeFetchStub(
  responses: (DownloadResponse | (() => Promise<DownloadResponse>) | Error)[],
): FetchFileStub {
  return { responses, calls: [], index: 0 };
}

function okResponse(bytes: Uint8Array): DownloadResponse {
  return {
    status: 200,
    ok: true,
    contentType: "application/octet-stream",
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      },
    }),
    statusText: "OK",
  };
}

function statusResponse(status: number): DownloadResponse {
  return {
    status,
    ok: status >= 200 && status < 300,
    contentType: null,
    body: null,
    statusText: `HTTP ${status}`,
  };
}

function makeEffects(opts: MakeEffectsOpts = {}): MakeEffectsBundle {
  const cfg: Config = opts.config ?? baseConfig();
  const store = opts.store ?? new MemoryTokenStore();
  const db = openDatabase({ path: ":memory:" });
  const fs = opts.fs ?? new Map<string, Uint8Array>();

  for (const m of opts.seedMessages ?? []) messagesDao.upsert(db, m);
  for (const f of opts.seedFiles ?? []) filesDao.upsert(db, f);

  const historyStub: ConvHistoryStub = opts.conversationsHistory ?? {
    mode: "ok",
    response: { messages: [] },
  };
  const fetchStub: FetchFileStub =
    opts.fetchFile ?? makeFetchStub([okResponse(new Uint8Array([1, 2, 3]))]);

  const effects: Effects = {
    configDir: "/tmp/download-test",
    env: {},
    loadConfig: async () => cfg,
    getDefaultWorkspace: async () => opts.defaultWorkspace ?? cfg.default_workspace,
    createTokenStore: opts.createTokenStoreThrow
      ? () => {
          // biome-ignore lint/style/noNonNullAssertion: guarded by the ternary above
          throw opts.createTokenStoreThrow!();
        }
      : () => store,
    createSlackClient: (_team_id, _token) => {
      const client = new SlackClient({ team_id: _team_id, token: _token });
      Object.defineProperty(client, "conversationsList", {
        value: async () => {
          const first = opts.conversationsList?.pages[0];
          return { channels: first?.channels ?? [], response_metadata: {} };
        },
      });
      Object.defineProperty(client, "conversationsHistory", {
        value: async (args: Record<string, unknown>) => {
          historyStub.capturedArgs = args;
          if (historyStub.mode === "throw") throw historyStub.error;
          return historyStub.response ?? { messages: [] };
        },
      });
      return client;
    },
    openDb: () => db, // テストでは事前に :memory: を開く
    fetchFile: async (url, token) => {
      fetchStub.calls.push({ url, token });
      const next = fetchStub.responses[fetchStub.index];
      fetchStub.index += 1;
      if (next === undefined) {
        throw new Error(`fetchFile called more times than stubbed (idx=${fetchStub.index - 1})`);
      }
      if (next instanceof Error) throw next;
      if (typeof next === "function") return next();
      return next;
    },
    writeBodyToFile: async (target, body) => {
      if (opts.writeBodyToFileThrow !== undefined) throw opts.writeBodyToFileThrow;
      const reader = body.getReader();
      const chunks: Uint8Array[] = [];
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (value) chunks.push(value);
      }
      const total = chunks.reduce((n, c) => n + c.length, 0);
      const merged = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
        merged.set(c, off);
        off += c.length;
      }
      fs.set(target, merged);
      return total;
    },
    mkdirSync: () => {
      if (opts.mkdirThrow !== undefined) throw opts.mkdirThrow;
    },
    statSync: (p) => {
      const v = fs.get(p);
      if (v === undefined) {
        const err = new Error(`ENOENT: no such file ${p}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      const stat: FileStat = { isFile: () => true, size: v.length };
      return stat;
    },
    now: () => 1700000999000,
  };

  if (!opts.storeMissing) {
    void store.set("T123", TOKEN);
  }

  return { effects, store, db, fs, fetchStub, historyStub };
}

describe("handleDownload", () => {
  let stdoutSpy: ReturnType<typeof spyOn> | null = null;
  let openedDbs: Database[] = [];

  beforeEach(() => {
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
    openedDbs = [];
  });

  afterEach(() => {
    mock.restore();
    stdoutSpy = null;
    for (const d of openedDbs) {
      try {
        d.close();
      } catch {
        /* already closed by handler.finally */
      }
    }
  });

  function track(b: MakeEffectsBundle): MakeEffectsBundle {
    openedDbs.push(b.db);
    return b;
  }

  function stdout(): string {
    return stdoutSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }

  it("(1) cache hit + 未 download: fetchFile 1 回, markDownloaded, jsonl 1 行", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow()],
      }),
    );
    const code = await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
      bundle.effects,
    );
    expect(code).toBe(0);
    expect(bundle.fetchStub.calls.length).toBe(1);
    expect(bundle.fetchStub.calls[0]?.token).toBe(TOKEN);
    expect(bundle.fetchStub.calls[0]?.url).toContain("F555");
    expect(bundle.fs.has("/tmp/out/F555.png")).toBe(true);
    const out = stdout();
    expect(out).toContain('"ok":true');
    expect(out).toContain('"file_id":"F555"');
    expect(out).toContain('"local_path":"/tmp/out/F555.png"');
    expect(out).toContain('"skipped":false');
    expect(out).toContain('"mimetype":"image/png"');
    // markDownloaded が走っている
    const updated = filesDao.get(bundle.db, "T123", "F555");
    expect(updated?.local_path).toBe("/tmp/out/F555.png");
    expect(updated?.downloaded_at).toBe(1700000999000);
  });

  it("(2) cache hit + 既 download: fetchFile 呼ばれない, skipped:true", async () => {
    const fs = new Map<string, Uint8Array>();
    fs.set("/tmp/out/F555.png", new Uint8Array(42));
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow({ local_path: "/tmp/out/F555.png", downloaded_at: 1700000900000 })],
        fs,
        fetchFile: makeFetchStub([]),
      }),
    );
    const code = await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
      bundle.effects,
    );
    expect(code).toBe(0);
    expect(bundle.fetchStub.calls.length).toBe(0);
    expect(stdout()).toContain('"skipped":true');
  });

  it("(3) cache hit + 既 download + --force: fetchFile が呼ばれる, skipped:false", async () => {
    const fs = new Map<string, Uint8Array>();
    fs.set("/tmp/out/F555.png", new Uint8Array(42));
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow({ local_path: "/tmp/out/F555.png", downloaded_at: 1700000900000 })],
        fs,
        fetchFile: makeFetchStub([okResponse(new Uint8Array([9, 9, 9, 9]))]),
      }),
    );
    const code = await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out", "--force"] }),
      bundle.effects,
    );
    expect(code).toBe(0);
    expect(bundle.fetchStub.calls.length).toBe(1);
    expect(stdout()).toContain('"skipped":false');
    expect(bundle.fs.get("/tmp/out/F555.png")).toEqual(new Uint8Array([9, 9, 9, 9]));
  });

  it("(4) cache hit + 既 download だが file 実体なし: fetchFile が呼ばれる", async () => {
    // local_path は記録上設定されているが fs Map には存在しない → 再 download
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow({ local_path: "/tmp/out/F555.png", downloaded_at: 1700000900000 })],
        // fs map に何もない
        fetchFile: makeFetchStub([okResponse(new Uint8Array([7, 7]))]),
      }),
    );
    const code = await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
      bundle.effects,
    );
    expect(code).toBe(0);
    expect(bundle.fetchStub.calls.length).toBe(1);
    expect(stdout()).toContain('"skipped":false');
  });

  it("(5) cache miss + --channel=Cxxx: history 1 回呼ばれる, message+files upsert, download", async () => {
    const slackMsg = {
      ts: TS,
      type: "message",
      text: "hi attached",
      files: [
        {
          id: "F777",
          name: "report.pdf",
          mimetype: "application/pdf",
          size: 50,
          url_private: "https://files.slack.com/F777",
        },
      ],
    };
    const bundle = track(
      makeEffects({
        seedMessages: [],
        seedFiles: [],
        conversationsHistory: { mode: "ok", response: { messages: [slackMsg] } },
        fetchFile: makeFetchStub([okResponse(new Uint8Array([5, 5, 5]))]),
      }),
    );
    const code = await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
      bundle.effects,
    );
    expect(code).toBe(0);
    expect(bundle.historyStub.capturedArgs).toMatchObject({
      channel: "C0123ABCDEF",
      oldest: TS,
      latest: TS,
      inclusive: true,
      limit: 1,
    });
    const stored = messagesDao.get(bundle.db, "T123", "C0123ABCDEF", TS);
    expect(stored?.text).toBe("hi attached");
    const fileRows = filesDao.listByMessage(bundle.db, "T123", "C0123ABCDEF", TS);
    expect(fileRows.length).toBe(1);
    expect(fileRows[0]?.file_id).toBe("F777");
    expect(stdout()).toContain('"file_id":"F777"');
    expect(stdout()).toContain('"local_path":"/tmp/out/F777.pdf"');
  });

  it("(6) cache miss + Slack も miss: UserError 'not found'", async () => {
    const bundle = track(
      makeEffects({
        conversationsHistory: { mode: "ok", response: { messages: [] } },
        fetchFile: makeFetchStub([]),
      }),
    );
    try {
      await handleDownload(makeCtx({ rest: [TS, "--channel=C0123ABCDEF"] }), bundle.effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not found");
    }
  });

  it("(7) cache miss + --channel なし: UserError Pass --channel", async () => {
    const bundle = track(makeEffects({ fetchFile: makeFetchStub([]) }));
    try {
      await handleDownload(makeCtx({ rest: [TS] }), bundle.effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("Pass --channel");
    }
  });

  it("(8) --channel name (cache hit) → conversationsList 不要 (I-4 cache 優先)", async () => {
    let listCalls = 0;
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow()],
        conversationsList: { pages: [{ channels: [] }] },
        fetchFile: makeFetchStub([okResponse(new Uint8Array([1]))]),
      }),
    );
    // I-4: cache hit があれば conversationsList は呼ばれないはずなので、
    // 呼ばれたら検出するように差し替え
    const realCreate = bundle.effects.createSlackClient;
    bundle.effects.createSlackClient = (team_id, token) => {
      const c = realCreate(team_id, token);
      const orig = c.conversationsList;
      Object.defineProperty(c, "conversationsList", {
        value: async (...args: unknown[]) => {
          listCalls += 1;
          return orig.apply(c, args as never);
        },
      });
      return c;
    };
    const code = await handleDownload(
      makeCtx({ rest: [TS, "--channel=general", "--out=/tmp/out"] }),
      bundle.effects,
    );
    expect(code).toBe(0);
    expect(listCalls).toBe(0);
  });

  it("(9) --out=<dir>: writeBodyToFile target が <dir>/<file_id>.<ext>", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow()],
      }),
    );
    await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/var/spool/dl"] }),
      bundle.effects,
    );
    expect([...bundle.fs.keys()]).toEqual(["/var/spool/dl/F555.png"]);
  });

  it("(10) 複数 files: 全件 download, jsonl 行数 = 件数, order 保持", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [
          makeFileRow({ file_id: "F1", url_private: "https://files.slack.com/F1" }),
          makeFileRow({
            file_id: "F2",
            name: "doc.pdf",
            mimetype: "application/pdf",
            url_private: "https://files.slack.com/F2",
          }),
          makeFileRow({
            file_id: "F3",
            name: null,
            mimetype: null,
            url_private: "https://files.slack.com/F3",
          }),
        ],
        fetchFile: makeFetchStub([
          okResponse(new Uint8Array([1])),
          okResponse(new Uint8Array([2])),
          okResponse(new Uint8Array([3])),
        ]),
      }),
    );
    const code = await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
      bundle.effects,
    );
    expect(code).toBe(0);
    expect(bundle.fetchStub.calls.length).toBe(3);
    const lines = stdout().trim().split("\n");
    expect(lines.length).toBe(3);
    expect(lines[0]).toContain('"file_id":"F1"');
    expect(lines[1]).toContain('"file_id":"F2"');
    expect(lines[2]).toContain('"file_id":"F3"');
    // 拡張子推定: F1=.png(name diagram.png), F2=.pdf(name doc.pdf), F3=空
    expect(bundle.fs.has("/tmp/out/F1.png")).toBe(true);
    expect(bundle.fs.has("/tmp/out/F2.pdf")).toBe(true);
    expect(bundle.fs.has("/tmp/out/F3")).toBe(true);
  });

  it("(11) HTTP 401: UserError abort (2 件目以降 fetch されない)", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [
          makeFileRow({ file_id: "F1", url_private: "https://files.slack.com/F1" }),
          makeFileRow({ file_id: "F2", url_private: "https://files.slack.com/F2" }),
        ],
        fetchFile: makeFetchStub([statusResponse(401)]),
      }),
    );
    try {
      await handleDownload(
        makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
        bundle.effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("token unauthorized");
    }
    expect(bundle.fetchStub.calls.length).toBe(1);
  });

  it("(12) HTTP 500: TransientError abort", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow()],
        fetchFile: makeFetchStub([statusResponse(500)]),
      }),
    );
    try {
      await handleDownload(
        makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
        bundle.effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("500");
    }
  });

  it("(13) HTTP 404: UserError abort", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow()],
        fetchFile: makeFetchStub([statusResponse(404)]),
      }),
    );
    try {
      await handleDownload(
        makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
        bundle.effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("404");
    }
  });

  it("(14) AbortError (timeout): TransientError", async () => {
    const abortErr = new Error("aborted");
    abortErr.name = "AbortError";
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow()],
        fetchFile: makeFetchStub([abortErr]),
      }),
    );
    try {
      await handleDownload(
        makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
        bundle.effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("timeout");
    }
  });

  it("(15) fileRows 0 件: stdout 空, logger.warn, EXIT_OK", async () => {
    const logger = new CapturingLogger();
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [],
        fetchFile: makeFetchStub([]),
      }),
    );
    const code = await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF"], logger }),
      bundle.effects,
    );
    expect(code).toBe(0);
    expect(stdout()).toBe("");
    expect(logger.warns.some((w) => w.includes("no files attached"))).toBe(true);
    expect(bundle.fetchStub.calls.length).toBe(0);
  });

  it("(16) --workspace 不正形式: UserError", async () => {
    const bundle = track(makeEffects());
    try {
      await handleDownload(
        makeCtx({ workspace: "not-a-team-id", rest: [TS, "--channel=C0123ABCDEF"] }),
        bundle.effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("--workspace must match");
    }
  });

  it("(17) token 未登録: UserError 'no token stored'", async () => {
    const store = new MemoryTokenStore();
    const bundle = track(makeEffects({ store, storeMissing: true, fetchFile: makeFetchStub([]) }));
    try {
      await handleDownload(makeCtx({ rest: [TS, "--channel=C0123ABCDEF"] }), bundle.effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("no token stored");
    }
  });

  it("(18) createTokenStore がプラットフォーム不一致 throw → UserError", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T123: { name: "Acme", default_channel: null, tokens_store: "keychain" },
      },
      output: { format: "jsonl", cache_window_days: 7 },
    };
    const bundle = track(
      makeEffects({
        config: cfg,
        createTokenStoreThrow: () =>
          new Error('Keychain backend is macOS-only. Use TokensStore="file" or run on macOS.'),
      }),
    );
    try {
      await handleDownload(makeCtx({ rest: [TS, "--channel=C0123ABCDEF"] }), bundle.effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg).toContain("cannot use keychain token backend on this platform");
      expect(msg).toContain("config tokens-store file");
    }
  });

  it("(19) 拡張子推定: name 優先 / mimetype fallback / 両 null", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [
          makeFileRow({ file_id: "F1", name: "x.PNG", mimetype: null }),
          makeFileRow({ file_id: "F2", name: null, mimetype: "image/jpeg" }),
          makeFileRow({ file_id: "F3", name: null, mimetype: null }),
          makeFileRow({ file_id: "F4", name: "noext", mimetype: "application/zip" }),
        ],
        fetchFile: makeFetchStub([
          okResponse(new Uint8Array([1])),
          okResponse(new Uint8Array([1])),
          okResponse(new Uint8Array([1])),
          okResponse(new Uint8Array([1])),
        ]),
      }),
    );
    await handleDownload(
      makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
      bundle.effects,
    );
    const keys = [...bundle.fs.keys()];
    expect(keys).toContain("/tmp/out/F1.png"); // name 優先 (lower-case)
    expect(keys).toContain("/tmp/out/F2.jpg"); // mimetype fallback
    expect(keys).toContain("/tmp/out/F3"); // 両 null
    expect(keys).toContain("/tmp/out/F4.zip"); // name に拡張子なし → mimetype fallback
  });

  it("(20) RateLimitedError on history → TransientError", async () => {
    const rateLimitErr = Object.assign(new Error("rate limited"), {
      code: ErrorCode.RateLimitedError,
      retryAfter: 30,
    });
    const bundle = track(
      makeEffects({
        conversationsHistory: { mode: "throw", error: rateLimitErr },
        fetchFile: makeFetchStub([]),
      }),
    );
    try {
      await handleDownload(makeCtx({ rest: [TS, "--channel=C0123ABCDEF"] }), bundle.effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("rate limited");
    }
  });

  it("(21) writeBodyToFile が ENOSPC throw → UserError", async () => {
    const enospc = Object.assign(new Error("ENOSPC: no space"), {
      code: "ENOSPC",
    }) as NodeJS.ErrnoException;
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow()],
        writeBodyToFileThrow: enospc,
      }),
    );
    try {
      await handleDownload(
        makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
        bundle.effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("cannot write");
    }
  });

  it("(22) cache hit + url_private が null → UserError 'no url_private'", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow({ url_private: null })],
        fetchFile: makeFetchStub([]),
      }),
    );
    try {
      await handleDownload(
        makeCtx({ rest: [TS, "--channel=C0123ABCDEF", "--out=/tmp/out"] }),
        bundle.effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("no url_private");
    }
  });

  it("(23) cache hit (channel hint なし) で getByTs 1 件 → そのまま採用", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [makeMessageRow()],
        seedFiles: [makeFileRow()],
      }),
    );
    const code = await handleDownload(makeCtx({ rest: [TS, "--out=/tmp/out"] }), bundle.effects);
    expect(code).toBe(0);
    expect(bundle.fetchStub.calls.length).toBe(1);
  });

  it("(24) cache hit (channel hint なし) で getByTs 2 件 → UserError ambiguous", async () => {
    const bundle = track(
      makeEffects({
        seedMessages: [
          makeMessageRow({ channel_id: "C111" }),
          makeMessageRow({ channel_id: "C222" }),
        ],
        seedFiles: [
          makeFileRow({ channel_id: "C111", file_id: "FA" }),
          makeFileRow({ channel_id: "C222", file_id: "FB" }),
        ],
        fetchFile: makeFetchStub([]),
      }),
    );
    try {
      await handleDownload(makeCtx({ rest: [TS] }), bundle.effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("multiple cached channels");
    }
  });
});
