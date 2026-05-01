import type { OutputFormat } from "../../../config/types.ts";
import { type ColorFns, isColorEnabled, isEmojiEnabled, makeColors } from "../../../output/ansi.ts";
import { selectFormatter } from "../../../output/format.ts";
import { humanBytes } from "../../../output/human/index.ts";
import { getGlyphs, type RichGlyphs } from "../../../output/rich/index.ts";

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

interface RenderDownloadOpts {
  isTTY?: boolean;
  /** Override emoji detection (only affects `--rich`). */
  emojiEnabled?: boolean;
}

export function renderDownloadResult(
  result: DownloadResult,
  format: OutputFormat,
  opts: RenderDownloadOpts = {},
): string {
  if (format !== "human" && format !== "rich") {
    return selectFormatter(format).format(result);
  }
  const colors = makeColors(opts.isTTY === undefined ? isColorEnabled() : opts.isTTY);
  if (format === "human") {
    return renderDownloadResultHuman(result, colors);
  }
  const glyphs = getGlyphs(opts.emojiEnabled ?? isEmojiEnabled());
  return renderDownloadResultRich(result, colors, glyphs);
}

export function renderDownloadResultHuman(result: DownloadResult, colors: ColorFns): string {
  const sizePart =
    typeof result.size_bytes === "number" ? ` (${humanBytes(result.size_bytes)})` : "";
  const nameLabel =
    result.name !== undefined ? `${result.file_id} (${result.name})` : result.file_id;
  if (result.skipped) {
    const marker = colors.dim("↺ skipped:");
    return `${marker} ${nameLabel} → ${result.local_path}${sizePart}\n`;
  }
  const marker = colors.green("✓");
  return `${marker} ${nameLabel} → ${result.local_path}${sizePart}\n`;
}

export function renderDownloadResultRich(
  result: DownloadResult,
  colors: ColorFns,
  glyphs: RichGlyphs,
): string {
  const sizePart =
    typeof result.size_bytes === "number"
      ? ` ${colors.dim(`(${humanBytes(result.size_bytes)})`)}`
      : "";
  const nameLabel =
    result.name !== undefined
      ? `${colors.bold(result.file_id)} ${colors.dim(`(${result.name})`)}`
      : colors.bold(result.file_id);
  if (result.skipped) {
    const marker = colors.dim(`${glyphs.downloadSkipped} skipped:`);
    return `${marker} ${nameLabel} ${colors.dim("→")} ${result.local_path}${sizePart}\n`;
  }
  const marker = colors.green(colors.bold(glyphs.downloadOk));
  return `${marker} ${nameLabel} ${colors.dim("→")} ${result.local_path}${sizePart}\n`;
}
