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
});
