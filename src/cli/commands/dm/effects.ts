import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { getDefaultWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { resolveConfigDir } from "../../../config/path.ts";
import type { Config, TokensStore } from "../../../config/types.ts";
import { createTokenStore } from "../../../secrets/factory.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { SlackClient } from "../../../slack/client.ts";
import { openDatabase } from "../../../storage/db.ts";
import type { FileStat, Effects as PostEffects } from "../post/effects.ts";
import type { Effects as ReadEffects } from "../read/effects.ts";

export type { FileStat };

/**
 * I/O ports the `dm` handler depends on. dm 自身は post + read のサブセットを
 * 包含しつつ、両方の Effects を組み立てる材料 (`createSlackClient` や
 * `createTokenStore`) を共有する。
 *
 * dm 固有の追加値は無し（user 解決と conversations.open は
 * `slackClient` 経由で行うため）。
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

  // --- filesystem (post 経路用) ---
  readFile(path: string): Promise<string>;
  statSync(path: string): FileStat;

  // --- read 経路用 ---
  openDb(): Database;
  stdout: NodeJS.WritableStream;

  // --- clocks ---
  /** ms 単位（post 経路で使用）。 */
  now(): number;
  /** 秒単位（read 経路で使用）。 */
  nowSec(): number;
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
    openDb: () => openDatabase(),
    stdout: process.stdout,
    now: () => Date.now(),
    nowSec: () => Math.floor(Date.now() / 1000),
  };
}

/** dm Effects から post 経路用の Effects を切り出す。 */
export function toPostEffects(eff: Effects): PostEffects {
  return {
    configDir: eff.configDir,
    env: eff.env,
    loadConfig: eff.loadConfig,
    getDefaultWorkspace: eff.getDefaultWorkspace,
    createTokenStore: eff.createTokenStore,
    createSlackClient: eff.createSlackClient,
    readFile: eff.readFile,
    statSync: eff.statSync,
    now: eff.now,
  };
}

/** dm Effects から read 経路用の Effects を切り出す。 */
export function toReadEffects(eff: Effects): ReadEffects {
  return {
    configDir: eff.configDir,
    env: eff.env,
    openDb: eff.openDb,
    createTokenStore: eff.createTokenStore,
    createSlackClient: eff.createSlackClient,
    now: eff.nowSec,
    stdout: eff.stdout,
  };
}
