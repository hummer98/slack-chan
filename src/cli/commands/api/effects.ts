import { getDefaultWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { resolveConfigDir } from "../../../config/path.ts";
import type { Config, TokensStore } from "../../../config/types.ts";
import { createTokenStore } from "../../../secrets/factory.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { SlackClient } from "../../../slack/client.ts";

/**
 * I/O ports the `api` handler depends on. Tests inject a stub so the real
 * keychain / Slack HTTP never enter the unit tests. This is a strict subset
 * of the `post` handler's Effects (no filesystem I/O — `api` does not read
 * `--blocks` files or `--file` paths).
 */
export interface Effects {
  /** Resolved config dir (XDG). */
  configDir: string;
  /** Process env (kept for parity with other commands' Effects). */
  env: NodeJS.ProcessEnv;

  loadConfig(): Promise<Config>;
  /**
   * Implemented for parity with other commands' Effects, but the `api`
   * handler intentionally never calls this — `--workspace` has no fallback
   * (see workspace.ts and plan §5).
   */
  getDefaultWorkspace(): Promise<string | null>;

  createTokenStore(kind: TokensStore): TokenStore;
  createSlackClient(team_id: string, token: string): SlackClient;

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
    now: () => Date.now(),
  };
}
