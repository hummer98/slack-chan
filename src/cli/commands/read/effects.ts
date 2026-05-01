import type { Database } from "bun:sqlite";
import { resolveConfigDir } from "../../../config/path.ts";
import type { TokensStore } from "../../../config/types.ts";
import { createTokenStore } from "../../../secrets/factory.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { SlackClient } from "../../../slack/client.ts";
import { openDatabase } from "../../../storage/db.ts";

/**
 * I/O ports the `read` command depends on. Tests inject a stub by passing
 * `Partial<Effects>` so heavy globals (the real keychain, the home-dir
 * SQLite file, the Slack HTTP layer, `Date.now()`, `process.stdout`) never
 * leak into unit tests. plan §5.1 / §5.2.
 */
export interface Effects {
  configDir: string;
  env: NodeJS.ProcessEnv;
  /** Open the SQLite database (default impl uses XDG path). */
  openDb(): Database;
  /** Build a TokenStore for the requested backend. */
  createTokenStore(kind: TokensStore): TokenStore;
  /** Build a Slack client given (team_id, token). */
  createSlackClient(team_id: string, token: string): SlackClient;
  /** Current unix time in seconds. Tests inject a fixed clock. */
  now(): number;
  /** stdout sink. Tests replace with a `PassThrough` for byte-level assertions. */
  stdout: NodeJS.WritableStream;
}

export function defaultEffects(env: NodeJS.ProcessEnv = process.env): Effects {
  const configDir = resolveConfigDir({ env });
  return {
    configDir,
    env,
    openDb: () => openDatabase(),
    createTokenStore: (kind) => createTokenStore(kind, { configDir }),
    createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
    now: () => Math.floor(Date.now() / 1000),
    stdout: process.stdout,
  };
}
