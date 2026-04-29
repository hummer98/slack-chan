/**
 * The record emitted on stdout when `post` succeeds. Always `ok: true` —
 * any non-ok response from Slack is converted to a `CliError` upstream.
 *
 *   - `ts` / `channel` are filled by the `chat.postMessage` route.
 *   - `file_id` / `file_title` are filled by the `files.uploadV2` route
 *     (which does not return a top-level `ts`, hence `ts?` here).
 *   - `thread_ts` echoes `--thread` whenever it was supplied.
 */
export interface PostResult {
  ok: true;
  channel: string;
  ts?: string;
  thread_ts?: string;
  file_id?: string;
  file_title?: string;
}
