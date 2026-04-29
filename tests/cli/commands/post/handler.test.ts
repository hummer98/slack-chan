import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ErrorCode } from "@slack/web-api";
import type { Effects, FileStat } from "../../../../src/cli/commands/post/effects.ts";
import { handlePost } from "../../../../src/cli/commands/post/handler.ts";
import { InternalError, TransientError, UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";

const TOKEN = "xoxb-test-1234567890abcd";

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
    workspace: "T123",
    format: "jsonl",
    verbose: false,
    rest: [],
    logger: new StderrLogger(),
    ...overrides,
  };
}

interface ChatPostMessageStub {
  mode: "ok" | "throw";
  expectedArgs?: Record<string, unknown>;
  capturedArgs?: Record<string, unknown>;
  response?: { ok: boolean; ts?: string; channel?: string; error?: string };
  error?: unknown;
}

interface FilesUploadV2Stub {
  mode: "ok" | "throw";
  capturedArgs?: Record<string, unknown>;
  response?: {
    ok: boolean;
    files?: { id?: string; title?: string }[];
    error?: string;
  };
  error?: unknown;
}

interface MakeEffectsOpts {
  config?: Config;
  defaultWorkspace?: string | null;
  store?: MemoryTokenStore;
  storeMissing?: boolean;
  createTokenStoreThrow?: () => unknown;
  files?: Record<string, string>;
  fileStats?: Record<string, FileStat | (() => FileStat)>;
  conversationsListPages?: { channels?: { id: string; name?: string }[] }[];
  chatPostMessage?: ChatPostMessageStub;
  filesUploadV2?: FilesUploadV2Stub;
}

function makeEffects(opts: MakeEffectsOpts = {}): {
  effects: Effects;
  store: MemoryTokenStore;
  chatStub: ChatPostMessageStub;
  uploadStub: FilesUploadV2Stub;
} {
  const cfg: Config = opts.config ?? baseConfig();
  const store = opts.store ?? new MemoryTokenStore();
  const chatStub: ChatPostMessageStub = opts.chatPostMessage ?? {
    mode: "ok",
    response: { ok: true, ts: "1700000000.001000", channel: "C0123ABCDEF" },
  };
  const uploadStub: FilesUploadV2Stub = opts.filesUploadV2 ?? {
    mode: "ok",
    response: { ok: true, files: [{ id: "F555", title: "x.png" }] },
  };

  const effects: Effects = {
    configDir: "/tmp/post-test",
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
          const pages = opts.conversationsListPages ?? [];
          // Naïve single-page only — handler tests pass channel IDs (Cxxx)
          // for fast path coverage; (6) overrides this via opts.
          const first = pages[0];
          return {
            channels: first?.channels ?? [],
            response_metadata: {},
          };
        },
      });
      Object.defineProperty(client, "chatPostMessage", {
        value: async (args: Record<string, unknown>) => {
          chatStub.capturedArgs = args;
          if (chatStub.mode === "throw") throw chatStub.error;
          return chatStub.response;
        },
      });
      Object.defineProperty(client, "filesUploadV2", {
        value: async (args: Record<string, unknown>) => {
          uploadStub.capturedArgs = args;
          if (uploadStub.mode === "throw") throw uploadStub.error;
          return uploadStub.response;
        },
      });
      return client;
    },
    readFile: async (p) => {
      const v = opts.files?.[p];
      if (v === undefined) {
        const err = new Error(`ENOENT: no such file ${p}`) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      return v;
    },
    statSync: (p) => {
      const v = opts.fileStats?.[p];
      if (v === undefined) return { isFile: () => true };
      if (typeof v === "function") return v();
      return v;
    },
    now: () => 1700000000000,
  };

  if (!opts.storeMissing && store === (opts.store ?? store)) {
    // pre-populate token unless test asks for absence
    void store.set("T123", TOKEN);
  }

  return { effects, store, chatStub, uploadStub };
}

describe("handlePost", () => {
  let stdoutSpy: ReturnType<typeof spyOn> | null = null;

  beforeEach(() => {
    stdoutSpy = spyOn(process.stdout, "write").mockImplementation(() => true);
  });

  afterEach(() => {
    mock.restore();
    stdoutSpy = null;
  });

  function stdout(): string {
    return stdoutSpy?.mock.calls.map((c: unknown[]) => String(c[0])).join("") ?? "";
  }

  // ---------- 正常系 ----------

  it("(1) text 投稿: chatPostMessage が呼ばれる、stdout に jsonl record", async () => {
    const { effects, chatStub } = makeEffects();
    const code = await handlePost(makeCtx({ rest: ["C0123ABCDEF", "hello"] }), effects);
    expect(code).toBe(0);
    expect(chatStub.capturedArgs).toEqual({ channel: "C0123ABCDEF", text: "hello" });
    const out = stdout();
    expect(out).toContain('"ok":true');
    expect(out).toContain('"ts":"1700000000.001000"');
    expect(out).toContain('"channel":"C0123ABCDEF"');
  });

  it("(2) thread 投稿: thread_ts が args / record の両方に乗る", async () => {
    const { effects, chatStub } = makeEffects();
    const code = await handlePost(
      makeCtx({ rest: ["C0123ABCDEF", "hi", "--thread=1700000000.000100"] }),
      effects,
    );
    expect(code).toBe(0);
    expect(chatStub.capturedArgs).toMatchObject({
      channel: "C0123ABCDEF",
      text: "hi",
      thread_ts: "1700000000.000100",
    });
    expect(stdout()).toContain('"thread_ts":"1700000000.000100"');
  });

  it("(3) file 投稿: filesUploadV2 が呼ばれる、record に file_id", async () => {
    const { effects, uploadStub } = makeEffects({
      fileStats: { "/tmp/x.png": { isFile: () => true } },
    });
    const code = await handlePost(
      makeCtx({ rest: ["C0123ABCDEF", "see attached", "--file=/tmp/x.png"] }),
      effects,
    );
    expect(code).toBe(0);
    expect(uploadStub.capturedArgs).toMatchObject({
      channel_id: "C0123ABCDEF",
      initial_comment: "see attached",
      file: "/tmp/x.png",
      filename: "x.png",
    });
    // thread_ts 不在
    expect((uploadStub.capturedArgs as Record<string, unknown>).thread_ts).toBeUndefined();
    const out = stdout();
    expect(out).toContain('"file_id":"F555"');
    expect(out).toContain('"file_title":"x.png"');
  });

  it("(4) blocks インライン: chatPostMessage に blocks 配列が渡る", async () => {
    const { effects, chatStub } = makeEffects();
    const code = await handlePost(
      makeCtx({
        rest: ["C0123ABCDEF", "fallback", '--blocks=[{"type":"section"}]'],
      }),
      effects,
    );
    expect(code).toBe(0);
    expect((chatStub.capturedArgs as Record<string, unknown>).blocks).toEqual([
      { type: "section" },
    ]);
    expect((chatStub.capturedArgs as Record<string, unknown>).text).toBe("fallback");
  });

  it("(5) blocks ファイル: readFile を経由、parse 結果が args に渡る", async () => {
    const { effects, chatStub } = makeEffects({
      files: { "./blocks.json": '[{"type":"divider"}]' },
    });
    const code = await handlePost(
      makeCtx({ rest: ["C0123ABCDEF", "fallback", "--blocks=./blocks.json"] }),
      effects,
    );
    expect(code).toBe(0);
    expect((chatStub.capturedArgs as Record<string, unknown>).blocks).toEqual([
      { type: "divider" },
    ]);
  });

  it("(6) channel name → resolveChannel 経由", async () => {
    const { effects, chatStub } = makeEffects({
      conversationsListPages: [{ channels: [{ id: "C9999", name: "general" }] }],
    });
    const code = await handlePost(makeCtx({ rest: ["#general", "hi"] }), effects);
    expect(code).toBe(0);
    expect((chatStub.capturedArgs as Record<string, unknown>).channel).toBe("C9999");
  });

  // ---------- workspace / token エラー系 ----------

  it("(7) workspace 不在 + getDefaultWorkspace null → UserError", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {},
      output: { format: "jsonl", cache_window_days: 7 },
    };
    const { effects } = makeEffects({ config: cfg, defaultWorkspace: null });
    await expect(
      handlePost(makeCtx({ workspace: null, rest: ["C0123ABCDEF", "hi"] }), effects),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("(8) --workspace 指定したが config に未登録 → UserError 'not registered'", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {},
      output: { format: "jsonl", cache_window_days: 7 },
    };
    const { effects } = makeEffects({ config: cfg });
    try {
      await handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not registered");
    }
  });

  it("(9) token 未登録 → UserError 'no token stored'", async () => {
    const store = new MemoryTokenStore();
    // 何も set しない
    const { effects } = makeEffects({ store, storeMissing: true });
    try {
      await handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("no token stored");
    }
  });

  // ---------- Slack API エラー分類 ----------

  it("(10) rate limit (RateLimitedError) → TransientError", async () => {
    const rateLimitErr = Object.assign(new Error("rate limited"), {
      code: ErrorCode.RateLimitedError,
      retryAfter: 30,
    });
    const { effects } = makeEffects({
      chatPostMessage: { mode: "throw", error: rateLimitErr },
    });
    try {
      await handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("rate limited");
    }
  });

  it("(11) channel_not_found (PlatformError) → UserError", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "channel_not_found" },
    });
    const { effects } = makeEffects({
      chatPostMessage: { mode: "throw", error: platformErr },
    });
    await expect(
      handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("(12) not_in_channel → UserError", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "not_in_channel" },
    });
    const { effects } = makeEffects({
      chatPostMessage: { mode: "throw", error: platformErr },
    });
    await expect(
      handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("(13) invalid_auth → UserError", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "invalid_auth" },
    });
    const { effects } = makeEffects({
      chatPostMessage: { mode: "throw", error: platformErr },
    });
    await expect(
      handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("(14) 未知 PlatformError.data.error → InternalError", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "future_unknown_error" },
    });
    const { effects } = makeEffects({
      chatPostMessage: { mode: "throw", error: platformErr },
    });
    await expect(
      handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects),
    ).rejects.toBeInstanceOf(InternalError);
  });

  it("(15) ok=false で error 不在 → InternalError", async () => {
    const { effects } = makeEffects({
      chatPostMessage: { mode: "ok", response: { ok: false } },
    });
    await expect(
      handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects),
    ).rejects.toBeInstanceOf(InternalError);
  });

  // (16): redact は record の値に効かない (T012 plan §15-12)。テスト省略。

  it("(17) createTokenStore がプラットフォーム不一致で throw → UserError", async () => {
    // Realistic scenario: the workspace is configured to use the keychain
    // backend, but the host platform (e.g. Linux) cannot construct it.
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T123: { name: "Acme", default_channel: null, tokens_store: "keychain" },
      },
      output: { format: "jsonl", cache_window_days: 7 },
    };
    const { effects } = makeEffects({
      config: cfg,
      createTokenStoreThrow: () =>
        new Error('Keychain backend is macOS-only. Use TokensStore="file" or run on macOS.'),
    });
    try {
      await handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg).toContain("cannot use keychain token backend on this platform");
      expect(msg).toContain("config tokens-store file");
    }
  });

  it("(18) HTTP 503 → TransientError", async () => {
    const httpErr = Object.assign(new Error("http"), {
      code: ErrorCode.HTTPError,
      statusCode: 503,
    });
    const { effects } = makeEffects({
      chatPostMessage: { mode: "throw", error: httpErr },
    });
    try {
      await handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("503");
    }
  });

  it("(19) thread_not_found → UserError", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "thread_not_found" },
    });
    const { effects } = makeEffects({
      chatPostMessage: { mode: "throw", error: platformErr },
    });
    try {
      await handlePost(
        makeCtx({ rest: ["C0123ABCDEF", "hi", "--thread=1700000000.000100"] }),
        effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("thread_not_found");
    }
  });

  it("(20) --file ENOENT → UserError", async () => {
    const enoentErr = Object.assign(new Error("ENOENT: no such file"), {
      code: "ENOENT",
    });
    const { effects } = makeEffects({
      fileStats: {
        "/tmp/missing.png": () => {
          throw enoentErr;
        },
      },
    });
    try {
      await handlePost(
        makeCtx({ rest: ["C0123ABCDEF", "hi", "--file=/tmp/missing.png"] }),
        effects,
      );
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg).toContain("--file");
      expect(msg).toContain("/tmp/missing.png");
      expect(msg.toLowerCase()).toContain("not found");
    }
  });

  it("(21) --file が directory → UserError 'is not a regular file'", async () => {
    const { effects } = makeEffects({
      fileStats: { "/tmp/somedir": { isFile: () => false } },
    });
    try {
      await handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi", "--file=/tmp/somedir"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("is not a regular file");
    }
  });

  it("(22) --blocks + --thread 併用: text/blocks/thread_ts すべて args に乗る", async () => {
    const { effects, chatStub } = makeEffects();
    const code = await handlePost(
      makeCtx({
        rest: [
          "C0123ABCDEF",
          "fallback",
          '--blocks=[{"type":"section"}]',
          "--thread=1700000000.000200",
        ],
      }),
      effects,
    );
    expect(code).toBe(0);
    const args = chatStub.capturedArgs as Record<string, unknown>;
    expect(args.text).toBe("fallback");
    expect(args.blocks).toEqual([{ type: "section" }]);
    expect(args.thread_ts).toBe("1700000000.000200");
  });

  it("(23) --file + --thread 併用: 4 フィールド全部", async () => {
    const { effects, uploadStub } = makeEffects({
      fileStats: { "/tmp/y.png": { isFile: () => true } },
    });
    const code = await handlePost(
      makeCtx({
        rest: ["C0123ABCDEF", "ic", "--file=/tmp/y.png", "--thread=1700000000.000300"],
      }),
      effects,
    );
    expect(code).toBe(0);
    expect(uploadStub.capturedArgs).toMatchObject({
      channel_id: "C0123ABCDEF",
      initial_comment: "ic",
      file: "/tmp/y.png",
      thread_ts: "1700000000.000300",
    });
  });

  it("(24) RequestError + ECONNREFUSED → TransientError", async () => {
    const requestErr = Object.assign(new Error("request failed"), {
      code: ErrorCode.RequestError,
      original: { code: "ECONNREFUSED", message: "connect ECONNREFUSED 1.2.3.4:443" },
    });
    const { effects } = makeEffects({
      chatPostMessage: { mode: "throw", error: requestErr },
    });
    try {
      await handlePost(makeCtx({ rest: ["C0123ABCDEF", "hi"] }), effects);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("network ECONNREFUSED");
    }
  });
});
