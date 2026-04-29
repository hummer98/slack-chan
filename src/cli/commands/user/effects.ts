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
 * I/O ports the `user` handler depends on. Tests inject in-memory
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
  openDb(opts?: { path?: string }): Database;

  now(): number;
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
    now: () => Date.now(),
  };
}
