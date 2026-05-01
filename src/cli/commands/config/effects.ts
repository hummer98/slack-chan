import type { Database } from "bun:sqlite";
import { resolveConfigDir } from "../../../config/path.ts";
import type { TokensStore } from "../../../config/types.ts";
import { createTokenStore } from "../../../secrets/factory.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { SlackClient } from "../../../slack/client.ts";
import { openDatabase } from "../../../storage/db.ts";

/**
 * I/O ports the `config` sub-sub commands depend on. Tests inject a stub by
 * passing `Partial<Effects>` into each handler so heavy globals
 * (`process.platform`, the real keychain, the home-dir SQLite file, the
 * Slack HTTP layer) never enter the unit tests.
 */
export interface Effects {
  /** Resolved config dir for token / config IO. */
  configDir: string;
  /** Process env (used by `setWorkspace`/`saveConfig` for env-vs-file discrimination). */
  env: NodeJS.ProcessEnv;
  /** Platform string ("darwin", "linux", ...). Tests inject either branch. */
  platform: NodeJS.Platform;
  /** Open the SQLite database (default impl uses XDG path). */
  openDb(): Database;
  /** Build a TokenStore for the given backend. */
  createTokenStore(kind: TokensStore): TokenStore;
  /**
   * Pure helper: resolve the *default* tokens_store kind for a fresh
   * workspace. Implemented as `darwin → keychain, else → file` but exposed
   * via effects so tests can drive both branches without mocking
   * `process.platform`.
   */
  resolveDefaultTokensStore(platform: NodeJS.Platform): TokensStore;
  /** Build a Slack client given (team_id, token). */
  createSlackClient(team_id: string, token: string): SlackClient;
  /**
   * Whether stdin is connected to a TTY. Used by destructive commands to
   * decide between interactive prompt and refusing-without-`--yes`.
   * Injected here so tests don't depend on ambient `process.stdin.isTTY`,
   * which leaks into `prepublishOnly` (= `bun run test` spawned from an
   * interactive `npm publish`) and made one test hang for 4s.
   */
  isTTY(): boolean;
}

export function defaultResolveDefaultTokensStore(platform: NodeJS.Platform): TokensStore {
  return platform === "darwin" ? "keychain" : "file";
}

export function defaultEffects(env: NodeJS.ProcessEnv = process.env): Effects {
  const configDir = resolveConfigDir({ env });
  return {
    configDir,
    env,
    platform: process.platform,
    openDb: () => openDatabase(),
    createTokenStore: (kind) => createTokenStore(kind, { configDir }),
    resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
    createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
    isTTY: () => Boolean((process.stdin as { isTTY?: boolean }).isTTY),
  };
}
