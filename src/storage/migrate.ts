import type { Database } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import init0001Sql from "./migrations/0001__init.sql" with { type: "text" };
import init0002Sql from "./migrations/0002__messages_fts_trigram.sql" with { type: "text" };

export interface MigrationFile {
  version: number;
  name: string;
  filename: string;
  sql: string;
}

const MIGRATION_FILENAME_RE = /^(\d{4})__([a-z0-9][a-z0-9_-]*)\.sql$/;

const STATIC_MIGRATIONS: readonly MigrationFile[] = Object.freeze([
  {
    version: 1,
    name: "init",
    filename: "0001__init.sql",
    sql: init0001Sql,
  },
  {
    version: 2,
    name: "messages_fts_trigram",
    filename: "0002__messages_fts_trigram.sql",
    sql: init0002Sql,
  },
]);

export function appliedVersions(db: Database): Set<number> {
  ensureSchemaVersionsTable(db);
  const rows = db.query<{ id: number }, []>("SELECT id FROM schema_versions").all();
  return new Set(rows.map((r) => r.id));
}

export function runMigrations(db: Database, opts: { migrationsDir?: string } = {}): void {
  ensureSchemaVersionsTable(db);
  const migrations = opts.migrationsDir
    ? loadMigrations(opts.migrationsDir)
    : [...STATIC_MIGRATIONS];
  migrations.sort((a, b) => a.version - b.version);

  const applied = appliedVersions(db);
  const now = Date.now();
  const insertVersion = db.prepare(
    "INSERT OR IGNORE INTO schema_versions(id, name, applied_at) VALUES(?, ?, ?)",
  );

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue;
    const apply = db.transaction(() => {
      db.exec(migration.sql);
      insertVersion.run(migration.version, migration.name, now);
    });
    if (migration.name === "messages_fts_trigram") {
      const start = Date.now();
      apply();
      console.error(`[slack-chan] FTS rebuild done in ${Date.now() - start} ms`);
    } else {
      apply();
    }
  }
}

/**
 * Test-only: filesystem ベースで migrations ディレクトリから読み込む。
 * 本番経路は STATIC_MIGRATIONS（静的 import 配列）のみ。`bun build --compile`
 * バイナリで migration を確実に同梱するため。
 */
export function loadMigrations(dir: string): MigrationFile[] {
  const files = readdirSync(dir);
  const result: MigrationFile[] = [];
  const seen = new Set<number>();
  for (const filename of files) {
    if (!filename.endsWith(".sql")) continue;
    const match = MIGRATION_FILENAME_RE.exec(filename);
    if (!match) {
      throw new Error(`Invalid migration filename: ${filename}`);
    }
    const versionStr = match[1] as string;
    const name = match[2] as string;
    const version = Number.parseInt(versionStr, 10);
    if (seen.has(version)) {
      throw new Error(`Duplicate migration version: ${version}`);
    }
    seen.add(version);
    const sql = readFileSync(join(dir, filename), "utf8");
    result.push({ version, name, filename, sql });
  }
  result.sort((a, b) => a.version - b.version);
  return result;
}

function ensureSchemaVersionsTable(db: Database): void {
  db.exec(
    `CREATE TABLE IF NOT EXISTS schema_versions (
       id          INTEGER PRIMARY KEY,
       name        TEXT NOT NULL,
       applied_at  INTEGER NOT NULL
     );`,
  );
}
