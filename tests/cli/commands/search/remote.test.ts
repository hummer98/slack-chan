import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from "bun:test";
import { ErrorCode, WebClient } from "@slack/web-api";
import { searchRemote } from "../../../../src/cli/commands/search/remote.ts";
import { InternalError, TransientError, UserError } from "../../../../src/cli/errors.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { SlackClient } from "../../../../src/slack/client.ts";

const TOKEN = "xoxp-test-1234567890abcd";

type ApiResponse = Record<string, unknown>;
type ApiHandler = (
  params: Record<string, unknown>,
) => Promise<ApiResponse> | ApiResponse | Promise<never> | never;

function mockApi(handler: ApiHandler) {
  const proto = WebClient.prototype as unknown as {
    apiCall: (method: string, params?: unknown) => Promise<unknown>;
  };
  return spyOn(proto, "apiCall").mockImplementation(async (method, params) => {
    if (method !== "search.messages") {
      throw new Error(`unexpected method ${method}`);
    }
    return handler((params ?? {}) as Record<string, unknown>);
  });
}

function newClient(): SlackClient {
  return new SlackClient({ team_id: "T1", token: TOKEN });
}

describe("searchRemote", () => {
  beforeEach(() => {
    // each test sets up its own mocks
  });

  afterEach(() => {
    mock.restore();
  });

  test("(2) success: ok=true with matches", async () => {
    mockApi(() => ({
      ok: true,
      query: '"deploy"',
      messages: {
        total: 2,
        pagination: { page: 1, page_count: 1 },
        matches: [
          {
            channel: { id: "C1", name: "ops" },
            user: "U1",
            ts: "1700000001.000000",
            text: "deploy started",
            permalink: "https://slack/p1",
          },
          {
            channel: { id: "C2", name: "general" },
            user: "U2",
            ts: "1700000002.000000",
            text: "deploy done",
            permalink: "https://slack/p2",
          },
        ],
      },
    }));
    const result = await searchRemote({
      client: newClient(),
      token: TOKEN,
      query: '"deploy"',
      count: 100,
      logger: new StderrLogger(),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.hits.length).toBe(2);
    expect(result.hits[0]?.channel_id).toBe("C1");
    expect(result.hits[0]?.permalink).toBe("https://slack/p1");
    expect(result.total).toBe(2);
  });

  test("(3) pagination.page_count > 1 surfaced", async () => {
    mockApi(() => ({
      ok: true,
      messages: {
        total: 250,
        pagination: { page: 1, page_count: 3 },
        matches: [{ channel: { id: "C1" }, ts: "1700000001.000000", text: "a", user: "U1" }],
      },
    }));
    const result = await searchRemote({
      client: newClient(),
      token: TOKEN,
      query: '"deploy"',
      count: 100,
      logger: new StderrLogger(),
    });
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") return;
    expect(result.pagination.page_count).toBe(3);
  });

  test("(4) ok=false with not_allowed_token_type -> skipped", async () => {
    mockApi(() => ({ ok: false, error: "not_allowed_token_type" }));
    const result = await searchRemote({
      client: newClient(),
      token: TOKEN,
      query: '"deploy"',
      count: 100,
      logger: new StderrLogger(),
    });
    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") return;
    expect(result.reason).toBe("not_allowed_token_type");
  });

  test("(5) ok=false with missing_scope -> skipped", async () => {
    mockApi(() => ({ ok: false, error: "missing_scope" }));
    const result = await searchRemote({
      client: newClient(),
      token: TOKEN,
      query: '"deploy"',
      count: 100,
      logger: new StderrLogger(),
    });
    expect(result.kind).toBe("skipped");
    if (result.kind !== "skipped") return;
    expect(result.reason).toBe("missing_scope");
  });

  test("(6) invalid_auth -> UserError thrown", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "invalid_auth" },
    });
    mockApi(() => {
      throw platformErr;
    });
    await expect(
      searchRemote({
        client: newClient(),
        token: TOKEN,
        query: '"deploy"',
        count: 100,
        logger: new StderrLogger(),
      }),
    ).rejects.toBeInstanceOf(UserError);
  });

  test("(7) RateLimitedError -> TransientError", async () => {
    const rateLimitErr = Object.assign(new Error("rate limited"), {
      code: ErrorCode.RateLimitedError,
      retryAfter: 30,
    });
    mockApi(() => {
      throw rateLimitErr;
    });
    await expect(
      searchRemote({
        client: newClient(),
        token: TOKEN,
        query: '"deploy"',
        count: 100,
        logger: new StderrLogger(),
      }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  test("(8) account_inactive -> UserError", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "account_inactive" },
    });
    mockApi(() => {
      throw platformErr;
    });
    await expect(
      searchRemote({
        client: newClient(),
        token: TOKEN,
        query: '"deploy"',
        count: 100,
        logger: new StderrLogger(),
      }),
    ).rejects.toBeInstanceOf(UserError);
  });

  test("(9) HTTP 503 -> TransientError", async () => {
    const httpErr = Object.assign(new Error("http"), {
      code: ErrorCode.HTTPError,
      statusCode: 503,
    });
    mockApi(() => {
      throw httpErr;
    });
    await expect(
      searchRemote({
        client: newClient(),
        token: TOKEN,
        query: '"deploy"',
        count: 100,
        logger: new StderrLogger(),
      }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  test("(10) ECONNREFUSED -> TransientError", async () => {
    const reqErr = Object.assign(new Error("request failed"), {
      code: ErrorCode.RequestError,
      original: { code: "ECONNREFUSED", message: "connect ECONNREFUSED" },
    });
    mockApi(() => {
      throw reqErr;
    });
    await expect(
      searchRemote({
        client: newClient(),
        token: TOKEN,
        query: '"deploy"',
        count: 100,
        logger: new StderrLogger(),
      }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  test("(11) future unknown PlatformError -> InternalError", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "future_unknown_error" },
    });
    mockApi(() => {
      throw platformErr;
    });
    await expect(
      searchRemote({
        client: newClient(),
        token: TOKEN,
        query: '"deploy"',
        count: 100,
        logger: new StderrLogger(),
      }),
    ).rejects.toBeInstanceOf(InternalError);
  });

  test("(12) query is passed through to apiCall verbatim", async () => {
    const calls: Array<Record<string, unknown>> = [];
    mockApi((params) => {
      calls.push(params);
      return {
        ok: true,
        messages: { total: 0, pagination: { page: 1, page_count: 1 }, matches: [] },
      };
    });
    const composed = '"deploy" in:#ops from:@alice';
    const result = await searchRemote({
      client: newClient(),
      token: TOKEN,
      query: composed,
      count: 100,
      logger: new StderrLogger(),
    });
    expect(result.kind).toBe("ok");
    expect(calls.length).toBe(1);
    expect(calls[0]?.query).toBe(composed);
    expect(calls[0]?.count).toBe(100);
    expect(calls[0]?.page).toBe(1);
  });
});
