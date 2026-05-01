import type { Database } from "bun:sqlite";
import { statSync } from "node:fs";
import { resolveConfigDir } from "../../../config/path.ts";
import { openDatabase, resolveDefaultDbPath } from "../../../storage/db.ts";

export interface Effects {
  configDir: string;
  env: NodeJS.ProcessEnv;
  openDb(): Database;
  /** stats が DB ファイルサイズを取りに行く path（":memory:" の場合は statBytes が 0 を返す前提）。 */
  dbPath: string;
  /** `fs.statSync(path).size` 相当。":memory:" は 0 を返す。 */
  statBytes(path: string): number;
  stdout: NodeJS.WritableStream;
  now(): number;
}

export function defaultEffects(env: NodeJS.ProcessEnv = process.env): Effects {
  const configDir = resolveConfigDir({ env });
  const dbPath = resolveDefaultDbPath(env);
  return {
    configDir,
    env,
    openDb: () => openDatabase(),
    dbPath,
    statBytes: (path) => {
      if (path === ":memory:") return 0;
      try {
        return statSync(path).size;
      } catch {
        return 0;
      }
    },
    stdout: process.stdout,
    now: () => Math.floor(Date.now() / 1000),
  };
}
