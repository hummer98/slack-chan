import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fts5SanityCheck, openDatabase, resolveDefaultDbPath } from "../../src/storage/db.ts";

describe("fts5SanityCheck", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", { create: true });
  });

  afterEach(() => {
    db.close();
  });

  test("does not throw on a Bun runtime that supports FTS5", () => {
    expect(() => fts5SanityCheck(db)).not.toThrow();
  });

  test("throws ADR-0001 message when db.exec rejects FTS5", () => {
    const stub = {
      exec(_sql: string): void {
        throw new Error("no such module: fts5");
      },
    };
    expect(() => fts5SanityCheck(stub)).toThrow(/FTS5 not available/);
  });
});

describe("resolveDefaultDbPath", () => {
  test("uses XDG_DATA_HOME when set", () => {
    const p = resolveDefaultDbPath({ XDG_DATA_HOME: "/custom/share" } as NodeJS.ProcessEnv);
    expect(p).toBe("/custom/share/slack-chan/cache.db");
  });

  test("falls back to ~/.local/share when XDG_DATA_HOME is empty", () => {
    const p = resolveDefaultDbPath({ XDG_DATA_HOME: "" } as NodeJS.ProcessEnv);
    expect(p.endsWith(".local/share/slack-chan/cache.db")).toBe(true);
  });
});

describe("openDatabase", () => {
  test("opens an in-memory db with bootstrap and runs migrations", () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      const row = db
        .query<{ name: string }, []>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='workspaces'",
        )
        .get();
      expect(row?.name).toBe("workspaces");
    } finally {
      db.close();
    }
  });
});
