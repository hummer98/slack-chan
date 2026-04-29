import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { appliedVersions, loadMigrations, runMigrations } from "../../src/storage/migrate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "src", "storage", "migrations");

describe("runMigrations", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", { create: true });
  });

  afterEach(() => {
    db.close();
  });

  test("creates all expected tables, indexes and triggers", () => {
    runMigrations(db);

    const tableNames = db
      .query<{ name: string }, []>(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
      )
      .all()
      .map((r) => r.name);
    for (const name of [
      "workspaces",
      "channels",
      "messages",
      "users",
      "files",
      "schema_versions",
      "messages_fts",
    ]) {
      expect(tableNames).toContain(name);
    }

    const indexNames = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='index'")
      .all()
      .map((r) => r.name);
    expect(indexNames).toContain("idx_messages_thread");
    expect(indexNames).toContain("idx_messages_user");
    expect(indexNames).toContain("idx_messages_fetched");

    const triggerNames = db
      .query<{ name: string }, []>("SELECT name FROM sqlite_master WHERE type='trigger'")
      .all()
      .map((r) => r.name);
    expect(triggerNames).toContain("messages_ai");
    expect(triggerNames).toContain("messages_ad");
    expect(triggerNames).toContain("messages_au");
  });

  test("appliedVersions returns Set([1]) after first run", () => {
    runMigrations(db);
    expect(appliedVersions(db)).toEqual(new Set([1]));
  });

  test("is idempotent (running twice does not duplicate schema_versions rows)", () => {
    runMigrations(db);
    runMigrations(db);
    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM schema_versions").get();
    expect(count?.c).toBe(1);
  });
});

describe("loadMigrations", () => {
  test("loads files from disk in version order with valid filename pattern", () => {
    const list = loadMigrations(migrationsDir);
    expect(list.length).toBeGreaterThanOrEqual(1);
    expect(list[0]?.version).toBe(1);
    expect(list[0]?.name).toBe("init");
    expect(list[0]?.filename).toBe("0001__init.sql");
    expect(list[0]?.sql).toContain("CREATE TABLE workspaces");
  });
});
