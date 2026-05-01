// T025 / ADR-0012: migration 0002 の単体テスト。
// 既存 cache (v1 適用済み) を seed → v2 適用後に rebuild が走り、
// trigram 経路で部分一致できることを検証する。
//
// migrate.test.ts の v1-only 適用テスト (新規 install シナリオ) と役割分担:
// - migrate.test.ts: fresh install (v1 単体 / v2 まで一括) で schema が揃うこと
// - 本ファイル: 既存 v1 cache に対し v2 が rebuild + trigger 引き継ぎを行うこと
import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadMigrations, runMigrations } from "../../src/storage/migrate.ts";

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, "..", "..", "src", "storage", "migrations");

function readFtsCreateSql(db: Database): string {
  const row = db
    .query<{ sql: string }, []>(
      "SELECT sql FROM sqlite_master WHERE type='table' AND name='messages_fts'",
    )
    .get();
  return row?.sql ?? "";
}

function insertMessage(db: Database, args: { ts: string; text: string }): void {
  db.prepare(
    `INSERT INTO messages (
       team_id, channel_id, ts, thread_ts, user_id, type, subtype,
       text, edited_ts, raw_json, fetched_at
     ) VALUES (?, ?, ?, NULL, ?, ?, NULL, ?, NULL, ?, ?)`,
  ).run("T1", "C1", args.ts, "U1", "message", args.text, "{}", 1700000000);
}

describe("migration 0002 (messages_fts_trigram)", () => {
  let db: Database;

  beforeEach(() => {
    db = new Database(":memory:", { create: true });
  });

  afterEach(() => {
    db.close();
  });

  test("(mig-1) fresh install: messages_fts DDL に trigram tokenizer が含まれる", () => {
    runMigrations(db);
    const sql = readFtsCreateSql(db);
    expect(sql).toContain("trigram");
    expect(sql).toContain("case_sensitive");
  });

  test("(mig-2) v1 のみ適用 → seed → v2 適用で rebuild が走り trigram で hit する", () => {
    // 1) v1 のみ手動適用 (loadMigrations で v1 だけを抜き出す)
    const all = loadMigrations(migrationsDir);
    const v1 = all.find((m) => m.version === 1);
    if (!v1) throw new Error("v1 migration not found");
    db.exec(
      `CREATE TABLE schema_versions (
         id INTEGER PRIMARY KEY,
         name TEXT NOT NULL,
         applied_at INTEGER NOT NULL
       );`,
    );
    db.transaction(() => {
      db.exec(v1.sql);
      db.prepare("INSERT INTO schema_versions(id, name, applied_at) VALUES(?, ?, ?)").run(
        1,
        v1.name,
        Date.now(),
      );
    })();

    // 2) seed (v1 の unicode61 経路で投入)
    insertMessage(db, { ts: "1700000001.000000", text: "宿泊費の精算をお願いします" });
    insertMessage(db, { ts: "1700000002.000000", text: "全く無関係な投稿" });

    // 3) v2 まで適用 → rebuild が走るはず
    runMigrations(db);

    // 4) trigram で部分一致 hit を確認
    const phrase = '"宿泊費"';
    const rows = db
      .query<{ text: string }, [string]>(
        "SELECT m.text FROM messages m JOIN messages_fts ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ?",
      )
      .all(phrase);
    expect(rows.length).toBe(1);
    expect(rows[0]?.text).toBe("宿泊費の精算をお願いします");
  });

  test("(mig-3) v2 適用後、INSERT/UPDATE/DELETE の trigger が新しい messages_fts を更新する", () => {
    runMigrations(db);

    // INSERT trigger
    insertMessage(db, { ts: "1700000001.000000", text: "リマインドします" });
    let rows = db
      .query<{ text: string }, [string]>(
        "SELECT m.text FROM messages m JOIN messages_fts ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ?",
      )
      .all('"リマインド"');
    expect(rows.length).toBe(1);

    // UPDATE trigger
    db.prepare("UPDATE messages SET text = ? WHERE team_id = ? AND channel_id = ? AND ts = ?").run(
      "打ち合わせ予定",
      "T1",
      "C1",
      "1700000001.000000",
    );
    rows = db
      .query<{ text: string }, [string]>(
        "SELECT m.text FROM messages m JOIN messages_fts ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ?",
      )
      .all('"打ち合わせ"');
    expect(rows.length).toBe(1);
    rows = db
      .query<{ text: string }, [string]>(
        "SELECT m.text FROM messages m JOIN messages_fts ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ?",
      )
      .all('"リマインド"');
    expect(rows.length).toBe(0);

    // DELETE trigger
    db.prepare("DELETE FROM messages WHERE team_id = ? AND channel_id = ? AND ts = ?").run(
      "T1",
      "C1",
      "1700000001.000000",
    );
    rows = db
      .query<{ text: string }, [string]>(
        "SELECT m.text FROM messages m JOIN messages_fts ON m.rowid = messages_fts.rowid WHERE messages_fts MATCH ?",
      )
      .all('"打ち合わせ"');
    expect(rows.length).toBe(0);
  });

  test("(mig-4) 連続 runMigrations は冪等で schema_versions = {1, 2}", () => {
    runMigrations(db);
    runMigrations(db);
    const ids = db
      .query<{ id: number }, []>("SELECT id FROM schema_versions ORDER BY id")
      .all()
      .map((r) => r.id);
    expect(ids).toEqual([1, 2]);
  });
});
