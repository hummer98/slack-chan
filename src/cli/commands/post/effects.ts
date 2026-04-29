import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getDefaultWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { resolveConfigDir } from "../../../config/path.ts";
import type { Config, TokensStore } from "../../../config/types.ts";
import { createTokenStore } from "../../../secrets/factory.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { SlackClient } from "../../../slack/client.ts";

/** handler が statSync の戻り値に対して必要とする最小契約。 */
export interface FileStat {
  isFile(): boolean;
}

/**
 * I/O ports the `post` handler depends on. Tests inject a stub by passing a
 * partial Effects with in-memory stores so the real keychain / Slack HTTP /
 * filesystem never enter the unit tests.
 */
export interface Effects {
  /** Resolved config dir (XDG). */
  configDir: string;
  /** Process env (for getDefaultWorkspace's env override path). */
  env: NodeJS.ProcessEnv;

  // --- config / workspace ---
  loadConfig(): Promise<Config>;
  getDefaultWorkspace(): Promise<string | null>;

  // --- secrets ---
  /**
   * Build a TokenStore for the given backend kind. May throw on platform
   * mismatch (e.g. keychain on Linux); caller is responsible for converting
   * the failure to a `UserError`.
   */
  createTokenStore(kind: TokensStore): TokenStore;

  // --- slack ---
  createSlackClient(team_id: string, token: string): SlackClient;

  // --- filesystem ---
  /** Used by `--blocks=<path>`. UTF-8 only. */
  readFile(path: string): Promise<string>;
  /** Used by `--file`. ENOENT etc. propagate as exceptions. */
  statSync(path: string): FileStat;

  /** Reserved for future retry timing; not used in T012. */
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
    readFile: (p) => readFile(p, "utf8"),
    statSync: (p) => statSync(p),
    now: () => Date.now(),
  };
}
