import { ErrorCode } from "@slack/web-api";
import type { Logger } from "../../../output/logger.ts";
import type { SlackClient } from "../../../slack/client.ts";
import { CliError, InternalError, TransientError, UserError } from "../../errors.ts";

export const WARN_TOKEN_TYPE_NOT_ALLOWED =
  "search: skipped Slack search.messages — current token does not allow it (xoxb does not support search). Returning cached-only results. To enable, register a user OAuth token with the 'search:read' scope.";

export const WARN_MISSING_SCOPE =
  "search: skipped Slack search.messages — current token is missing the 'search:read' scope. Returning cached-only results.";

export const WARN_XOXB_PREFIX =
  "search: workspace is configured with a bot token (xoxb-*) — Slack search.messages is unavailable. Falling back to --cached-only.";

export const WARN_PAGINATION_TRUNCATED = (pageCount: number): string =>
  `search: Slack returned ${pageCount} pages; only page 1 is included (v1 limitation).`;

export type SkippedReason = "xoxb" | "not_allowed_token_type" | "missing_scope" | "invalid_auth";

export function skippedReasonMessage(reason: SkippedReason): string {
  switch (reason) {
    case "xoxb":
      return WARN_XOXB_PREFIX;
    case "not_allowed_token_type":
      return WARN_TOKEN_TYPE_NOT_ALLOWED;
    case "missing_scope":
      return WARN_MISSING_SCOPE;
    case "invalid_auth":
      return WARN_TOKEN_TYPE_NOT_ALLOWED;
  }
}

export interface RemoteSearchHit {
  channel_id: string;
  ts: string;
  user_id: string | null;
  text: string | null;
  permalink: string | null;
  raw_match: unknown;
}

export interface RemoteSearchPagination {
  page: number;
  page_count: number;
}

export type RemoteSearchResult =
  | {
      kind: "ok";
      hits: RemoteSearchHit[];
      total: number;
      pagination: RemoteSearchPagination;
    }
  | {
      kind: "skipped";
      reason: SkippedReason;
    };

export interface RemoteSearchOpts {
  client: SlackClient;
  token: string;
  query: string;
  count: number;
  logger: Logger;
}

const USER_API_ERRORS: ReadonlySet<string> = new Set([
  "not_authed",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "no_permission",
  "invalid_arguments",
  "fatal_error",
]);

const SKIPPED_API_ERRORS: ReadonlySet<string> = new Set([
  "not_allowed_token_type",
  "missing_scope",
]);

const TRANSIENT_API_ERRORS: ReadonlySet<string> = new Set([
  "ratelimited",
  "rate_limited",
  "timeout",
  "service_unavailable",
]);

const TRANSIENT_NETWORK_CODES: ReadonlySet<string> = new Set([
  "ECONNREFUSED",
  "ECONNRESET",
  "ETIMEDOUT",
  "ENOTFOUND",
  "EAI_AGAIN",
]);

interface ApiSearchMatch {
  channel?: { id?: string; name?: string };
  user?: string;
  ts?: string;
  text?: string;
  permalink?: string;
  [k: string]: unknown;
}

interface ApiSearchResponse {
  ok?: boolean;
  error?: string;
  messages?: {
    total?: number;
    pagination?: {
      page?: number;
      page_count?: number;
    };
    matches?: ApiSearchMatch[];
  };
}

/**
 * Try to translate a thrown Slack SDK error into either a CliError to be
 * propagated, or a `skipped` result so cached-only fallback can take over.
 */
function classifySlackError(e: unknown): CliError | { kind: "skipped"; reason: SkippedReason } {
  if (e instanceof CliError) return e;
  if (!(e instanceof Error)) return new InternalError(`search: ${String(e)}`);

  const code = (e as { code?: string }).code;

  if (code === ErrorCode.RateLimitedError) {
    const retry = (e as { retryAfter?: number }).retryAfter;
    return new TransientError(
      `search: rate limited (retry-after=${typeof retry === "number" ? retry : "?"}s)`,
    );
  }
  if (code === ErrorCode.PlatformError) {
    const apiError = (e as { data?: { error?: unknown } }).data?.error;
    if (typeof apiError === "string") {
      if (SKIPPED_API_ERRORS.has(apiError)) {
        return { kind: "skipped", reason: apiError as SkippedReason };
      }
      if (USER_API_ERRORS.has(apiError)) return new UserError(`search: ${apiError}`);
      if (TRANSIENT_API_ERRORS.has(apiError)) return new TransientError(`search: ${apiError}`);
      return new InternalError(`search: ${apiError}`);
    }
    return new InternalError(`search: ${e.message}`);
  }
  if (code === ErrorCode.HTTPError) {
    const status = (e as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 500 && status < 600) {
      return new TransientError(`search: HTTP ${status}`);
    }
    if (typeof status === "number" && status === 429) {
      return new TransientError("search: HTTP 429 (rate limited)");
    }
    return new InternalError(`search: HTTP ${status ?? "?"}: ${e.message}`);
  }
  if (code === ErrorCode.RequestError) {
    const original = (e as { original?: { code?: string; message?: string } }).original;
    const ncode = original?.code;
    if (typeof ncode === "string" && TRANSIENT_NETWORK_CODES.has(ncode)) {
      return new TransientError(`search: network ${ncode}`);
    }
    return new InternalError(`search: request error: ${original?.message ?? e.message}`);
  }
  return new InternalError(`search: ${e.message}`);
}

export async function searchRemote(opts: RemoteSearchOpts): Promise<RemoteSearchResult> {
  const { client, query, count } = opts;

  let res: ApiSearchResponse;
  try {
    res = (await client.searchMessages({
      query,
      count,
      page: 1,
      sort: "score",
      sort_dir: "desc",
    })) as ApiSearchResponse;
  } catch (err) {
    const cls = classifySlackError(err);
    if (cls instanceof CliError) throw cls;
    return cls;
  }

  if (res.ok !== true) {
    const errStr = res.error ?? "unknown";
    if (SKIPPED_API_ERRORS.has(errStr)) {
      return { kind: "skipped", reason: errStr as SkippedReason };
    }
    if (USER_API_ERRORS.has(errStr)) {
      throw new UserError(`search: ${errStr}`);
    }
    if (TRANSIENT_API_ERRORS.has(errStr)) {
      throw new TransientError(`search: ${errStr}`);
    }
    throw new InternalError(`search: ${errStr}`);
  }

  const messages = res.messages ?? {};
  const matches = Array.isArray(messages.matches) ? messages.matches : [];
  const hits: RemoteSearchHit[] = [];
  for (const m of matches) {
    const channel_id = m.channel?.id;
    const ts = m.ts;
    if (typeof channel_id !== "string" || channel_id.length === 0) continue;
    if (typeof ts !== "string" || ts.length === 0) continue;
    hits.push({
      channel_id,
      ts,
      user_id: typeof m.user === "string" ? m.user : null,
      text: typeof m.text === "string" ? m.text : null,
      permalink: typeof m.permalink === "string" ? m.permalink : null,
      raw_match: m,
    });
  }

  return {
    kind: "ok",
    hits,
    total: typeof messages.total === "number" ? messages.total : hits.length,
    pagination: {
      page: typeof messages.pagination?.page === "number" ? messages.pagination.page : 1,
      page_count:
        typeof messages.pagination?.page_count === "number" ? messages.pagination.page_count : 1,
    },
  };
}
