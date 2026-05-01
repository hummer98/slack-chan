/**
 * Per-file record emitted on stdout when `download` succeeds. Always
 * `ok: true` — any failure is converted to a `CliError` upstream and the
 * remaining files in the message are NOT processed (Fail-fast, plan §5.1).
 *
 *   - `local_path` is the absolute path the file was written to.
 *   - `skipped` is `true` only when the cache+fs already had the file and
 *     `--force` was not set (idempotent retry path).
 *   - `size_bytes` is the bytes written for new downloads, or the on-disk
 *     size for skipped files.
 *   - `name` / `mimetype` echo the values the cache has for the file (may
 *     be `undefined` when Slack did not supply them).
 */
export interface DownloadResult {
  ok: true;
  file_id: string;
  name?: string;
  local_path: string;
  skipped: boolean;
  size_bytes?: number;
  mimetype?: string;
}
