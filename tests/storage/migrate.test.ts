// fts-trigram-migration.test.ts の (mig-2) は v1 適用後の既存 cache に対する v2 rebuild
// シナリオを検証する。本ファイル末尾の「v1 単体適用」テストはそれと役割が異なり、
// fresh install (新規 cache 作成) の時点で 0001__init.sql 自体が trigram tokenizer で
// messages_fts を作成することを確認する。
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

  test("appliedVersions returns Set([1, 2]) after first run", () => {
    runMigrations(db);
    expect(appliedVersions(db)).toEqual(new Set([1, 2]));
  });

  test("is idempotent (running twice does not duplicate schema_versions rows)", () => {
    runMigrations(db);
    runMigrations(db);
    const count = db.query<{ c: number }, []>("SELECT COUNT(*) AS c FROM schema_versions").get();
    expect(count?.c).toBe(2);
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

// fresh install シナリオ: 0001__init.sql 単体で trigram tokenizer が適用される。
// loadMigrations で v1 のみを抜き出して適用し、v2 の rebuild を経由せずに
// messages_fts が trigram で作られることを確認する。
describe("0001__init.sql fresh install (trigram tokenizer alignment)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", { create: true });
  });

  afterEach(() => {
    db.close();
  });

  test("v1 alone creates messages_fts with trigram tokenizer", () => {
    const all = loadMigrations(migrationsDir);
    const v1 = all.find((m) => m.version === 1);
    if (!v1) throw new Error("v1 migration not found");
    db.exec(v1.sql);
    const row = db
      .query<{ sql: string }, []>(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='messages_fts'",
      )
      .get();
    expect(row?.sql ?? "").toContain("trigram");
    expect(row?.sql ?? "").toContain("case_sensitive");
  });
});
