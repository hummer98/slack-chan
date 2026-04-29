import type { Database } from "bun:sqlite";
import { resolveConfigDir } from "../../../config/path.ts";
import type { TokensStore } from "../../../config/types.ts";
import { createTokenStore } from "../../../secrets/factory.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { SlackClient } from "../../../slack/client.ts";
import { openDatabase } from "../../../storage/db.ts";

export interface Effects {
  configDir: string;
  env: NodeJS.ProcessEnv;
  openDb(): Database;
  createTokenStore(kind: TokensStore): TokenStore;
  createSlackClient(team_id: string, token: string): SlackClient;
  now(): number;
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
