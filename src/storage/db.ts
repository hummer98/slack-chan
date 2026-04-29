import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { runMigrations } from "./migrate.ts";

export interface OpenDatabaseOptions {
  path?: string;
  skipBootstrap?: boolean;
}

export interface DatabaseLike {
  exec(sql: string): unknown;
}

export function resolveDefaultDbPath(env: NodeJS.ProcessEnv = process.env): string {
  const xdg = env.XDG_DATA_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".local", "share");
  return join(base, "slack-chan", "cache.db");
}

export function fts5SanityCheck(db: DatabaseLike): void {
  try {
    db.exec("CREATE VIRTUAL TABLE __fts USING fts5(x); DROP TABLE __fts;");
  } catch (cause) {
    throw new Error(
      "FTS5 not available in this Bun runtime. ADR-0001 mandates a fallback to better-sqlite3; please update docs/decisions/0001-sqlite-driver.md and switch the driver in src/storage/db.ts.",
      { cause },
    );
  }
}

export function openDatabase(opts: OpenDatabaseOptions = {}): Database {
  const path = opts.path ?? resolveDefaultDbPath();
  const inMemory = path === ":memory:";
  if (!inMemory) {
    mkdirSync(dirname(path), { recursive: true });
  }
  const db = new Database(path, { create: true });
  if (!inMemory) {
    db.exec("PRAGMA journal_mode = WAL;");
  }
  db.exec("PRAGMA foreign_keys = ON;");
  db.exec("PRAGMA busy_timeout = 5000;");

  if (!opts.skipBootstrap) {
    fts5SanityCheck(db);
    runMigrations(db);
  }
  return db;
}

export type { Database };
