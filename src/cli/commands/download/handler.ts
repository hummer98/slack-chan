import type { Database } from "bun:sqlite";
import { extname, join } from "node:path";
import { ErrorCode } from "@slack/web-api";
import { selectFormatter } from "../../../output/format.ts";
import type { SlackClient } from "../../../slack/client.ts";
import * as filesDao from "../../../storage/dao/files.ts";
import * as messagesDao from "../../../storage/dao/messages.ts";
import type { FileRow, MessageRow, MessageUpsertInput } from "../../../storage/types.ts";
import { CliError, InternalError, TransientError, UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { type DownloadArgs, parseDownloadArgv } from "./argv.ts";
import { resolveChannel } from "./channels.ts";
import { type Effects, type FileStat, resolveDefaultFilesDir } from "./effects.ts";
import type { DownloadResult } from "./output.ts";
import { loadToken, resolveWorkspace } from "./workspace.ts";

const USER_API_ERRORS: ReadonlySet<string> = new Set([
  "channel_not_found",
  "not_in_channel",
  "is_archived",
  "invalid_arguments",
  "not_authed",
  "invalid_auth",
  "account_inactive",
  "token_revoked",
  "missing_scope",
  "messages_not_found",
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

const MIME_EXT_MAP: Record<string, string> = {
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/webp": ".webp",
  "image/svg+xml": ".svg",
  "application/pdf": ".pdf",
  "text/plain": ".txt",
  "text/csv": ".csv",
  "application/json": ".json",
  "application/zip": ".zip",
  "video/mp4": ".mp4",
  "audio/mpeg": ".mp3",
};

const EXT_RE = /^\.[a-z0-9]{1,8}$/;

function pickExtension(row: FileRow): string {
  if (row.name !== null && row.name.length > 0) {
    const ext = extname(row.name).toLowerCase();
    if (EXT_RE.test(ext)) return ext;
  }
  if (row.mimetype !== null) {
    const m = MIME_EXT_MAP[row.mimetype.toLowerCase()];
    if (m !== undefined) return m;
  }
  return "";
}

function chooseFilename(row: FileRow): string {
  return `${row.file_id}${pickExtension(row)}`;
}

/**
 * Convert a Slack-SDK error (history call) into one of the three CliError
 * subclasses. Mirrors post.classifySlackError but with the `download:`
 * prefix and the download-relevant `USER_API_ERRORS` set.
 */
export function classifySlackError(e: unknown): CliError {
  if (e instanceof CliError) return e;
  if (!(e instanceof Error)) return new InternalError(`download: ${String(e)}`);

  const code = (e as { code?: string }).code;

  if (code === ErrorCode.RateLimitedError) {
    const retry = (e as { retryAfter?: number }).retryAfter;
    return new TransientError(
      `download: rate limited (retry-after=${typeof retry === "number" ? retry : "?"}s)`,
    );
  }
  if (code === ErrorCode.PlatformError) {
    const apiError = (e as { data?: { error?: unknown } }).data?.error;
    if (typeof apiError === "string") {
      if (USER_API_ERRORS.has(apiError)) return new UserError(`download: ${apiError}`);
      if (TRANSIENT_API_ERRORS.has(apiError)) return new TransientError(`download: ${apiError}`);
      return new InternalError(`download: ${apiError}`);
    }
    return new InternalError(`download: ${e.message}`);
  }
  if (code === ErrorCode.HTTPError) {
    const status = (e as { statusCode?: number }).statusCode;
    if (typeof status === "number" && status >= 500 && status < 600) {
      return new TransientError(`download: HTTP ${status}`);
    }
    if (typeof status === "number" && status === 429) {
      return new TransientError("download: HTTP 429 (rate limited)");
    }
    return new InternalError(`download: HTTP ${status ?? "?"}: ${e.message}`);
  }
  if (code === ErrorCode.RequestError) {
    const original = (e as { original?: { code?: string; message?: string } }).original;
    const ncode = original?.code;
    if (typeof ncode === "string" && TRANSIENT_NETWORK_CODES.has(ncode)) {
      return new TransientError(`download: network ${ncode}`);
    }
    return new InternalError(`download: request error: ${original?.message ?? e.message}`);
  }
  return new InternalError(`download: ${e.message}`);
}

interface SlackHistoryResponse {
  messages?: SlackMessage[];
  ok?: boolean;
  error?: string;
}

interface SlackMessage {
  ts?: string;
  thread_ts?: string;
  user?: string;
  type?: string;
  subtype?: string;
  text?: string;
  edited?: { ts?: string };
  files?: SlackFile[];
  [k: string]: unknown;
}

interface SlackFile {
  id?: string;
  name?: string;
  mimetype?: string;
  size?: number;
  url_private?: string;
  [k: string]: unknown;
}

/**
 * Resolve `--channel`'s value to a channel id. Cache-first (I-4): when a
 * name is supplied, prefer the cached channel_id of the same ts (avoids a
 * full `conversations.list` scan when not needed). Falls back to
 * `resolveChannel` only on cache miss.
 */
async function resolveChannelHint(
  hint: string,
  args: { db: Database; team_id: string; ts: string; slackClient: SlackClient },
): Promise<string> {
  if (/^[CGD][A-Z0-9]{1,32}$/.test(hint)) return hint;
  const cached = messagesDao.getByTs(args.db, args.team_id, args.ts);
  // We have a single cached row; trust its channel_id rather than paying
  // for a full conversations.list page-walk just to translate a name.
  const single = cached.length === 1 ? cached[0] : undefined;
  if (single !== undefined) return single.channel_id;
  return resolveChannel(hint, args.slackClient);
}

interface LocateMessageArgs {
  db: Database;
  slackClient: SlackClient;
  team_id: string;
  ts: string;
  channelHint: string | undefined;
  now: number;
}

interface LocatedMessage {
  message: MessageRow;
  channel_id: string;
}

async function locateMessage(args: LocateMessageArgs): Promise<LocatedMessage> {
  const { db, slackClient, team_id, ts } = args;

  // hint なし: cache 全 channel から探す
  if (args.channelHint === undefined) {
    const cached = messagesDao.getByTs(db, team_id, ts);
    const only = cached.length === 1 ? cached[0] : undefined;
    if (only !== undefined) {
      return { message: only, channel_id: only.channel_id };
    }
    if (cached.length >= 2) {
      throw new UserError(
        `download: ts=${ts} matches multiple cached channels (${cached
          .map((r) => r.channel_id)
          .join(", ")}). Pass --channel=<id> to disambiguate.`,
      );
    }
    throw new UserError(
      `download: message ts=${ts} not found in cache. ` +
        "Pass --channel=<id|name> so we can fetch it from Slack.",
    );
  }

  // hint あり: 解決順は (1) cache 直接 hit (2) Slack history fetch
  const channel_id = await resolveChannelHint(args.channelHint, args);
  const hit = messagesDao.get(db, team_id, channel_id, ts);
  if (hit !== null) {
    // Re-upsert files from cached raw_json so a refreshed url_private (post
    // sync) lands without losing the existing local_path / downloaded_at
    // (the upsert COALESCEs those fields).
    refreshFilesFromRaw(db, hit);
    return { message: hit, channel_id };
  }

  // cache miss → Slack history
  let res: SlackHistoryResponse;
  try {
    res = (await slackClient.conversationsHistory({
      channel: channel_id,
      oldest: ts,
      latest: ts,
      inclusive: true,
      limit: 1,
    })) as SlackHistoryResponse;
  } catch (e) {
    throw classifySlackError(e);
  }
  const msgs = Array.isArray(res.messages) ? res.messages : [];
  const target = msgs.find((m) => m.ts === ts);
  if (target === undefined) {
    throw new UserError(
      `download: message ts=${ts} not found via conversations.history (channel=${channel_id}).`,
    );
  }

  const upsertInput: MessageUpsertInput = {
    team_id,
    channel_id,
    ts,
    thread_ts: typeof target.thread_ts === "string" ? target.thread_ts : null,
    user_id: typeof target.user === "string" ? target.user : null,
    type: typeof target.type === "string" ? target.type : null,
    subtype: typeof target.subtype === "string" ? target.subtype : null,
    text: typeof target.text === "string" ? target.text : null,
    edited_ts: typeof target.edited?.ts === "string" ? (target.edited.ts as string) : null,
    raw_json: JSON.stringify(target),
    fetched_at: args.now,
  };
  messagesDao.upsert(db, upsertInput);

  if (Array.isArray(target.files)) {
    for (const f of target.files) {
      upsertFileRow(db, team_id, channel_id, ts, f);
    }
  }

  const stored = messagesDao.get(db, team_id, channel_id, ts);
  if (stored === null) {
    throw new InternalError(`download: failed to persist message ts=${ts} for ${channel_id}.`);
  }
  return { message: stored, channel_id };
}

function upsertFileRow(
  db: Database,
  team_id: string,
  channel_id: string,
  ts: string,
  f: SlackFile,
): void {
  if (typeof f.id !== "string" || f.id.length === 0) return;
  filesDao.upsert(db, {
    team_id,
    file_id: f.id,
    channel_id,
    ts,
    name: typeof f.name === "string" ? f.name : null,
    mimetype: typeof f.mimetype === "string" ? f.mimetype : null,
    size: typeof f.size === "number" ? f.size : null,
    url_private: typeof f.url_private === "string" ? f.url_private : null,
    // Pass null for these so files.upsert COALESCE preserves any existing
    // local_path / downloaded_at on a re-sync.
    local_path: null,
    downloaded_at: null,
    raw_json: JSON.stringify(f),
  });
}

function refreshFilesFromRaw(db: Database, message: MessageRow): void {
  let raw: { files?: SlackFile[] };
  try {
    raw = JSON.parse(message.raw_json) as { files?: SlackFile[] };
  } catch {
    return;
  }
  if (!Array.isArray(raw.files)) return;
  for (const f of raw.files) {
    upsertFileRow(db, message.team_id, message.channel_id, message.ts, f);
  }
}

interface DownloadOneArgs {
  row: FileRow;
  token: string;
  outDir: string;
  force: boolean;
  db: Database;
  effects: Effects;
}

async function downloadOne(args: DownloadOneArgs): Promise<DownloadResult> {
  const { row, token, outDir, force, db, effects } = args;
  const target = join(outDir, chooseFilename(row));

  // skip 判定 (force 未指定時のみ)
  if (!force && row.local_path !== null && row.downloaded_at !== null) {
    const onDisk = tryStat(effects, row.local_path);
    if (onDisk?.isFile()) {
      const result: DownloadResult = {
        ok: true,
        file_id: row.file_id,
        local_path: row.local_path,
        skipped: true,
        size_bytes: onDisk.size,
      };
      if (row.name !== null) result.name = row.name;
      if (row.mimetype !== null) result.mimetype = row.mimetype;
      return result;
    }
    // DB 上は download 済みだが実体が消えている → 整合性自動修復で再 download
  }

  if (typeof row.url_private !== "string" || row.url_private.length === 0) {
    throw new UserError(
      `download: file ${row.file_id} has no url_private (was the message deleted on Slack?). ` +
        "Try `--force` after `slack-chan sync`.",
    );
  }

  let res: { status: number; ok: boolean; body: ReadableStream<Uint8Array> | null };
  try {
    res = await effects.fetchFile(row.url_private, token);
  } catch (e) {
    if (e instanceof CliError) throw e;
    if (e instanceof Error) {
      const code = (e as { name?: string }).name;
      if (code === "AbortError") {
        throw new TransientError(`download: timeout after 30s for file ${row.file_id}.`);
      }
      const ecode = (e as NodeJS.ErrnoException).code;
      if (typeof ecode === "string" && TRANSIENT_NETWORK_CODES.has(ecode)) {
        throw new TransientError(`download: network ${ecode} for file ${row.file_id}.`);
      }
      throw new TransientError(`download: network error for file ${row.file_id}: ${e.message}`);
    }
    throw new InternalError(`download: ${String(e)}`);
  }

  if (res.status === 401 || res.status === 403) {
    throw new UserError(
      `download: token unauthorized for url_private (HTTP ${res.status}). ` +
        "Token may lack files:read scope or workspace mismatch.",
    );
  }
  if (res.status === 404) {
    throw new UserError(
      `download: file ${row.file_id} url_private returned 404 (file deleted from Slack).`,
    );
  }
  if (res.status === 408 || res.status === 429 || (res.status >= 500 && res.status < 600)) {
    throw new TransientError(`download: HTTP ${res.status} for file ${row.file_id}.`);
  }
  if (res.status >= 400) {
    throw new UserError(`download: HTTP ${res.status} for file ${row.file_id}.`);
  }
  if (res.body === null) {
    throw new InternalError(`download: empty body for HTTP ${res.status} (file ${row.file_id}).`);
  }

  let bytes: number;
  try {
    bytes = await effects.writeBodyToFile(target, res.body);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const detail = e instanceof Error ? e.message : String(e);
    if (
      code === "ENOSPC" ||
      code === "EACCES" ||
      code === "EROFS" ||
      code === "ENOENT" ||
      code === "ENOTDIR"
    ) {
      throw new UserError(`download: cannot write ${target}: ${detail}`);
    }
    if (e instanceof CliError) throw e;
    throw new InternalError(`download: failed to write ${target}: ${detail}`);
  }

  filesDao.markDownloaded(db, row.team_id, row.file_id, target, effects.now());

  const result: DownloadResult = {
    ok: true,
    file_id: row.file_id,
    local_path: target,
    skipped: false,
    size_bytes: bytes,
  };
  if (row.name !== null) result.name = row.name;
  if (row.mimetype !== null) result.mimetype = row.mimetype;
  return result;
}

function tryStat(effects: Effects, p: string): FileStat | null {
  try {
    return effects.statSync(p);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    if (code === "ENOENT") return null;
    // 他の stat エラーは再 download 路に倒す (UserError は既 download 路でしか
    // 出さない: 実書き込み時の mkdir / write エラーは下流でちゃんと判別される)
    return null;
  }
}

/**
 * Main `download` handler. Implements the flow defined in plan §4:
 * argv parse → workspace → token → DB open → message lookup → per-file
 * download (Fail-fast) → format & write.
 *
 * Throws `CliError` subclasses; the outer dispatcher converts them.
 */
export async function handleDownload(ctx: CommandContext, effects: Effects): Promise<number> {
  const args: DownloadArgs = parseDownloadArgv(ctx.rest);

  const team_id = await resolveWorkspace(ctx, effects);

  const cfg = await effects.loadConfig();
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `download: workspace ${team_id} is not registered. Run \`slack-chan config workspace add --token=...\`.`,
    );
  }
  const token = await loadToken(team_id, ws.tokens_store, effects);

  const slackClient = effects.createSlackClient(team_id, token);
  // The DB handle is owned by the CLI process; we do not close it here
  // because the process exits at the end of the command. Tests inject an
  // `openDb` that returns a test-owned `:memory:` handle and close it in
  // `afterEach`.
  const db = effects.openDb();
  const now = effects.now();

  const { channel_id } = await locateMessage({
    db,
    slackClient,
    team_id,
    ts: args.ts,
    channelHint: args.channel,
    now,
  });

  const fileRows = filesDao.listByMessage(db, team_id, channel_id, args.ts);

  if (fileRows.length === 0) {
    ctx.logger.warn(`download: message ts=${args.ts} has no files attached.`);
    return EXIT_OK;
  }

  const baseDir = args.out ?? join(resolveDefaultFilesDir(effects.env), team_id);
  try {
    effects.mkdirSync(baseDir);
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    const detail = e instanceof Error ? e.message : String(e);
    if (code === "EACCES" || code === "ENOTDIR" || code === "ENOENT") {
      throw new UserError(`download: cannot create output directory ${baseDir}: ${detail}`);
    }
    throw new InternalError(`download: mkdir ${baseDir} failed: ${detail}`);
  }

  const formatter = selectFormatter(ctx.format);

  for (const row of fileRows) {
    const result = await downloadOne({
      row,
      token,
      outDir: baseDir,
      force: args.force,
      db,
      effects,
    });
    process.stdout.write(formatter.format(result));
  }

  return EXIT_OK;
}
