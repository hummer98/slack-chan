import type { WebAPICallResult } from "@slack/web-api";

/**
 * `api` is an escape hatch that surfaces Slack Web API responses verbatim,
 * including the `ok: false` error path. The shape is whatever the Slack
 * server returned, so we reuse `WebAPICallResult` (= `{ ok: boolean;
 * [key: string]: unknown; ... }`) as-is rather than wrapping it.
 */
export type ApiResult = WebAPICallResult;
