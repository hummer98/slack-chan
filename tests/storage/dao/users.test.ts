import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as users from "../../../src/storage/dao/users.ts";
import { openDatabase } from "../../../src/storage/db.ts";
import type { UserRow } from "../../../src/storage/types.ts";

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    team_id: "T1",
    user_id: "U1",
    name: "alice",
    real_name: "Alice",
    email: "alice@example.com",
    profile_json: '{"image":"x"}',
    fetched_at: 1700000000,
    ...overrides,
  };
}

describe("dao/users", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  test("upsert + get round-trips", () => {
    users.upsert(db, makeUser());
    expect(users.get(db, "T1", "U1")).toEqual(makeUser());
  });

  test("upsert called twice updates fields", () => {
    users.upsert(db, makeUser());
    users.upsert(db, makeUser({ real_name: "Alice Updated", fetched_at: 1700000200 }));
    const row = users.get(db, "T1", "U1");
    expect(row?.real_name).toBe("Alice Updated");
    expect(row?.fetched_at).toBe(1700000200);
  });

  test("get returns null for missing user", () => {
    expect(users.get(db, "T1", "U-missing")).toBeNull();
  });

  test("deleteByTeam removes only the matching team's rows", () => {
    users.upsert(db, makeUser({ team_id: "T1", user_id: "U1" }));
    users.upsert(db, makeUser({ team_id: "T2", user_id: "U1" }));
    users.deleteByTeam(db, "T1");
    expect(users.get(db, "T1", "U1")).toBeNull();
    expect(users.get(db, "T2", "U1")).not.toBeNull();
  });

  test("findByName: hit", () => {
    users.upsert(db, makeUser({ name: "alice" }));
    expect(users.findByName(db, "T1", "alice")).not.toBeNull();
  });

  test("findByName: miss returns null", () => {
    users.upsert(db, makeUser({ name: "alice" }));
    expect(users.findByName(db, "T1", "bob")).toBeNull();
  });

  test("findByName: case-insensitive", () => {
    users.upsert(db, makeUser({ name: "alice" }));
    expect(users.findByName(db, "T1", "Alice")).not.toBeNull();
    expect(users.findByName(db, "T1", "ALICE")).not.toBeNull();
  });

  test("findByName: separated by team_id", () => {
    users.upsert(db, makeUser({ team_id: "T1", user_id: "U1", name: "alice" }));
    users.upsert(db, makeUser({ team_id: "T2", user_id: "U1", name: "bob" }));
    expect(users.findByName(db, "T2", "alice")).toBeNull();
    expect(users.findByName(db, "T1", "alice")?.user_id).toBe("U1");
  });

  test("findByEmail: hit", () => {
    users.upsert(db, makeUser({ email: "alice@example.com" }));
    expect(users.findByEmail(db, "T1", "alice@example.com")).not.toBeNull();
  });

  test("findByEmail: case-insensitive", () => {
    users.upsert(db, makeUser({ email: "alice@example.com" }));
    expect(users.findByEmail(db, "T1", "ALICE@example.com")).not.toBeNull();
  });

  test("findByEmail: null email row is not matched", () => {
    users.upsert(db, makeUser({ email: null }));
    expect(users.findByEmail(db, "T1", "alice@example.com")).toBeNull();
  });

  test("count: 0 / 3", () => {
    expect(users.count(db, "T1")).toBe(0);
    users.upsert(db, makeUser({ user_id: "U1" }));
    users.upsert(db, makeUser({ user_id: "U2" }));
    users.upsert(db, makeUser({ user_id: "U3" }));
    expect(users.count(db, "T1")).toBe(3);
  });

  test("count: separated by team_id", () => {
    users.upsert(db, makeUser({ team_id: "T1", user_id: "U1" }));
    users.upsert(db, makeUser({ team_id: "T1", user_id: "U2" }));
    users.upsert(db, makeUser({ team_id: "T2", user_id: "U1" }));
    expect(users.count(db, "T1")).toBe(2);
    expect(users.count(db, "T2")).toBe(1);
  });
});
