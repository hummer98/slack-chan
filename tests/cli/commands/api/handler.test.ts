import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { ErrorCode, type WebAPICallResult } from "@slack/web-api";
import type { Effects } from "../../../../src/cli/commands/api/effects.ts";
import { handleApi } from "../../../../src/cli/commands/api/handler.ts";
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

interface ApiCallStub {
  mode: "ok" | "throw";
  capturedMethod?: string;
  capturedParams?: Record<string, unknown> | undefined;
  response?: WebAPICallResult;
  error?: unknown;
}

interface MakeEffectsOpts {
  config?: Config;
  store?: MemoryTokenStore;
  storeMissing?: boolean;
  createTokenStoreThrow?: () => unknown;
  apiCall?: ApiCallStub;
}

function makeEffects(opts: MakeEffectsOpts = {}): {
  effects: Effects;
  store: MemoryTokenStore;
  apiStub: ApiCallStub;
} {
  const cfg: Config = opts.config ?? baseConfig();
  const store = opts.store ?? new MemoryTokenStore();
  const apiStub: ApiCallStub = opts.apiCall ?? {
    mode: "ok",
    response: { ok: true, channel: { id: "C0123ABCDEF", name: "general" } } as WebAPICallResult,
  };

  const effects: Effects = {
    configDir: "/tmp/api-test",
    env: {},
    loadConfig: async () => cfg,
    getDefaultWorkspace: async () => cfg.default_workspace,
    createTokenStore: opts.createTokenStoreThrow
      ? () => {
          // biome-ignore lint/style/noNonNullAssertion: guarded by ternary
          throw opts.createTokenStoreThrow!();
        }
      : () => store,
    createSlackClient: (team_id, token) => {
      const client = new SlackClient({ team_id, token });
      Object.defineProperty(client, "apiCall", {
        value: async (method: string, params?: Record<string, unknown>) => {
          apiStub.capturedMethod = method;
          apiStub.capturedParams = params;
          if (apiStub.mode === "throw") throw apiStub.error;
          return apiStub.response;
        },
      });
      return client;
    },
    now: () => 1700000000000,
  };

  if (!opts.storeMissing) {
    void store.set("T123", TOKEN);
  }

  return { effects, store, apiStub };
}

describe("handleApi", () => {
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

  it("(1) ok:true → stdout に JSON 1 行 + EXIT_OK", async () => {
    const payload = {
      ok: true,
      channel: { id: "C0123ABCDEF", name: "general" },
    } as WebAPICallResult;
    const { effects, apiStub } = makeEffects({
      apiCall: { mode: "ok", response: payload },
    });
    const code = await handleApi(
      makeCtx({ rest: ["conversations.info", "channel=C0123ABCDEF"] }),
      effects,
    );
    expect(code).toBe(0);
    expect(apiStub.capturedMethod).toBe("conversations.info");
    expect(apiStub.capturedParams).toEqual({ channel: "C0123ABCDEF" });
    expect(stdout()).toBe(`${JSON.stringify(payload)}\n`);
  });

  it("(2) PlatformError (ok:false) → e.data を stdout に流して EXIT_OK", async () => {
    const errPayload = { ok: false, error: "channel_not_found" } as WebAPICallResult;
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: errPayload,
    });
    const { effects } = makeEffects({
      apiCall: { mode: "throw", error: platformErr },
    });
    const code = await handleApi(
      makeCtx({ rest: ["conversations.info", "channel=Cdoesnotexist"] }),
      effects,
    );
    expect(code).toBe(0);
    expect(stdout()).toBe(`${JSON.stringify(errPayload)}\n`);
  });

  it("(3) workspace=null → UserError 'no default fallback'", async () => {
    const { effects } = makeEffects();
    try {
      await handleApi(makeCtx({ workspace: null, rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("no default fallback");
    }
  });

  it("(4) workspace format mismatch → UserError 'must match'", async () => {
    const { effects } = makeEffects();
    try {
      await handleApi(makeCtx({ workspace: "Tbad!", rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("must match");
    }
  });

  it("(5) workspace not registered → UserError 'is not registered'", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {},
      output: { format: "jsonl", cache_window_days: 7 },
    };
    const { effects } = makeEffects({ config: cfg });
    try {
      await handleApi(makeCtx({ rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("is not registered");
    }
  });

  it("(6) RateLimitedError → TransientError", async () => {
    const rateErr = Object.assign(new Error("rate"), {
      code: ErrorCode.RateLimitedError,
      retryAfter: 30,
    });
    const { effects } = makeEffects({ apiCall: { mode: "throw", error: rateErr } });
    try {
      await handleApi(makeCtx({ rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("rate limited");
    }
  });

  it("(7) HTTPError 503 → TransientError", async () => {
    const httpErr = Object.assign(new Error("http"), {
      code: ErrorCode.HTTPError,
      statusCode: 503,
    });
    const { effects } = makeEffects({ apiCall: { mode: "throw", error: httpErr } });
    try {
      await handleApi(makeCtx({ rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("503");
    }
  });

  it("(8) HTTPError 400 → InternalError", async () => {
    const httpErr = Object.assign(new Error("bad request"), {
      code: ErrorCode.HTTPError,
      statusCode: 400,
    });
    const { effects } = makeEffects({ apiCall: { mode: "throw", error: httpErr } });
    try {
      await handleApi(makeCtx({ rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(InternalError);
      expect((e as InternalError).message).toContain("400");
    }
  });

  it("(9) RequestError + ECONNRESET → TransientError", async () => {
    const reqErr = Object.assign(new Error("req"), {
      code: ErrorCode.RequestError,
      original: { code: "ECONNRESET", message: "ECONNRESET" },
    });
    const { effects } = makeEffects({ apiCall: { mode: "throw", error: reqErr } });
    try {
      await handleApi(makeCtx({ rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(TransientError);
      expect((e as TransientError).message).toContain("network ECONNRESET");
    }
  });

  it("(10) param parse failure → UserError propagates", async () => {
    const { effects } = makeEffects();
    try {
      await handleApi(makeCtx({ rest: ["conversations.info", "bad-key=v"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("invalid parameter key");
    }
  });

  it("(11) apiCall arguments are passed through verbatim", async () => {
    const { effects, apiStub } = makeEffects();
    const code = await handleApi(
      makeCtx({
        rest: ["chat.postMessage", "channel=C0123ABCDEF", "text=hi", "limit:=10"],
      }),
      effects,
    );
    expect(code).toBe(0);
    expect(apiStub.capturedMethod).toBe("chat.postMessage");
    expect(apiStub.capturedParams).toEqual({
      channel: "C0123ABCDEF",
      text: "hi",
      limit: 10,
    });
  });

  it("(12) tokens_store=keychain throw → UserError 'cannot use ... token backend'", async () => {
    const cfg: Config = {
      default_workspace: null,
      workspaces: {
        T123: { name: "Acme", default_channel: null, tokens_store: "keychain" },
      },
      output: { format: "jsonl", cache_window_days: 7 },
    };
    const { effects } = makeEffects({
      config: cfg,
      createTokenStoreThrow: () => new Error("Keychain backend is macOS-only."),
    });
    try {
      await handleApi(makeCtx({ rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("cannot use keychain token backend");
    }
  });

  it("(13) no token stored → UserError 'no token stored'", async () => {
    const store = new MemoryTokenStore();
    const { effects } = makeEffects({ store, storeMissing: true });
    try {
      await handleApi(makeCtx({ rest: ["conversations.info"] }), effects);
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("no token stored");
    }
  });

  it("(14) --human: api は pretty JSON + dim を維持 (ADR-0013 fallback)", async () => {
    const payload = {
      ok: true,
      channel: { id: "C0123ABCDEF", name: "general" },
    } as WebAPICallResult;
    const { effects } = makeEffects({ apiCall: { mode: "ok", response: payload } });
    const code = await handleApi(
      makeCtx({ format: "human", rest: ["conversations.info", "channel=C0123ABCDEF"] }),
      effects,
    );
    expect(code).toBe(0);
    const out = stdout();
    // pretty JSON: 2-space indented + "ok": true 形
    expect(out).toContain('"ok": true');
    expect(out).toContain('"channel":');
  });
});
