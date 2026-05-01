import type { Database } from "bun:sqlite";
import { getDefaultWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { resolveConfigDir } from "../../../config/path.ts";
import type { Config, TokensStore } from "../../../config/types.ts";
import { createTokenStore } from "../../../secrets/factory.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { SlackClient } from "../../../slack/client.ts";
import { openDatabase } from "../../../storage/db.ts";

/**
 * I/O ports the `search` handler depends on. Tests inject in-memory
 * implementations so the real keychain / Slack HTTP / filesystem never enter
 * unit tests. plan §10.
 */
export interface Effects {
  configDir: string;
  env: NodeJS.ProcessEnv;

  loadConfig(): Promise<Config>;
  getDefaultWorkspace(): Promise<string | null>;

  createTokenStore(kind: TokensStore): TokenStore;
  createSlackClient(team_id: string, token: string): SlackClient;
  openDb(opts?: { path?: string }): Database;

  /** unix seconds (read.effects と統一; users.fetched_at 等の保存値は秒系列) */
  now(): number;

  stdout: NodeJS.WritableStream;
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
    now: () => Math.floor(Date.now() / 1000),
    stdout: process.stdout,
  };
}
