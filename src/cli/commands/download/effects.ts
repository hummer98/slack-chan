import type { Database } from "bun:sqlite";
import { mkdirSync, statSync as nodeStatSync } from "node:fs";
import { rename, unlink } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { getDefaultWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { resolveConfigDir } from "../../../config/path.ts";
import type { Config, TokensStore } from "../../../config/types.ts";
import { createTokenStore } from "../../../secrets/factory.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { SlackClient } from "../../../slack/client.ts";
import { openDatabase } from "../../../storage/db.ts";

/**
 * Minimal `statSync` contract the handler needs. Shares the post Effects
 * `FileStat` shape (I-1) and adds `size` for the skip-record `size_bytes`.
 */
export interface FileStat {
  isFile(): boolean;
  size: number;
}

/** Result of `fetchFile`. Mirrors the parts of `Response` we actually use. */
export interface DownloadResponse {
  status: number;
  ok: boolean;
  contentType: string | null;
  body: ReadableStream<Uint8Array> | null;
  statusText: string;
}

/**
 * I/O ports the `download` handler depends on. Tests inject in-memory
 * implementations so the real keychain / Slack HTTP / filesystem never
 * enter unit tests.
 */
export interface Effects {
  configDir: string;
  env: NodeJS.ProcessEnv;

  // --- config / workspace ---
  loadConfig(): Promise<Config>;
  getDefaultWorkspace(): Promise<string | null>;

  // --- secrets ---
  createTokenStore(kind: TokensStore): TokenStore;

  // --- slack ---
  createSlackClient(team_id: string, token: string): SlackClient;

  // --- DB ---
  /**
   * Open the SQLite cache. Tests pass `{ path: ":memory:" }`; production
   * calls leave `opts` undefined so `openDatabase` resolves the default path
   * via XDG (I-5).
   */
  openDb(opts?: { path?: string }): Database;

  // --- HTTP (file download) ---
  /**
   * Fetch `url_private` with `Authorization: Bearer <token>`. Network
   * failures throw; HTTP non-2xx returns a populated DownloadResponse so
   * the handler can map status codes to the right `CliError` subclass.
   */
  fetchFile(url: string, token: string): Promise<DownloadResponse>;

  /**
   * Stream `body` to a temp file then atomically rename to `targetPath`.
   * Returns the bytes written. Throws on FS failure (ENOSPC, EACCES); the
   * temp file is always cleaned up before the error propagates.
   */
  writeBodyToFile(targetPath: string, body: ReadableStream<Uint8Array>): Promise<number>;

  // --- Filesystem ---
  mkdirSync(path: string): void;
  /**
   * `statSync` returning the minimal `FileStat`. ENOENT throws; the handler
   * catches it as the "file does not exist on disk" branch (I-3: a single
   * port covers both existence and size).
   */
  statSync(path: string): FileStat;

  now(): number;
}

/**
 * Resolve the default download directory:
 *   `$XDG_DATA_HOME/slack-chan/files` → `~/.local/share/slack-chan/files`.
 * The `<team_id>` segment is appended by the handler.
 */
export function resolveDefaultFilesDir(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share");
  return join(base, "slack-chan", "files");
}

const FETCH_TIMEOUT_MS = 30_000;

async function defaultFetchFile(url: string, token: string): Promise<DownloadResponse> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}` },
      signal: ctrl.signal,
    });
    return {
      status: res.status,
      ok: res.ok,
      contentType: res.headers.get("content-type"),
      body: res.body,
      statusText: res.statusText,
    };
  } finally {
    clearTimeout(timer);
  }
}

async function defaultWriteBodyToFile(
  targetPath: string,
  body: ReadableStream<Uint8Array>,
): Promise<number> {
  const tmp = `${targetPath}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  try {
    // Wrap in a Response so Bun.write streams the body to disk without
    // buffering in memory (Bun.write accepts Response / Blob / string but
    // not a bare ReadableStream).
    const bytes = await Bun.write(tmp, new Response(body));
    await rename(tmp, targetPath);
    return bytes;
  } catch (err) {
    await unlink(tmp).catch(() => undefined);
    throw err;
  }
}

export function defaultEffects(env: NodeJS.ProcessEnv = process.env): Effects {
  const configDir = resolveConfigDir({ env });
  return {
    configDir,
    env,
    loadConfig: () => loadConfig({ configDir, env }),
    getDefaultWorkspace: () => getDefaultWorkspace({ configDir, env }),
    createTokenStore: (kind) => createTokenStore(kind, { configDir }),
    createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
    openDb: (opts) => openDatabase(opts ?? {}),
    fetchFile: defaultFetchFile,
    writeBodyToFile: defaultWriteBodyToFile,
    mkdirSync: (p) => {
      mkdirSync(p, { recursive: true });
    },
    statSync: (p) => {
      const st = nodeStatSync(p);
      return { isFile: () => st.isFile(), size: st.size };
    },
    now: () => Date.now(),
  };
}
