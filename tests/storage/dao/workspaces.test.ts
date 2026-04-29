import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as workspaces from "../../../src/storage/dao/workspaces.ts";
import { openDatabase } from "../../../src/storage/db.ts";

describe("dao/workspaces", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  test("insert + list round-trips", () => {
    workspaces.insert(db, {
      team_id: "T1",
      name: "Acme",
      url: "https://acme.slack.com",
      default_channel: null,
      added_at: 1700000000,
    });
    workspaces.insert(db, {
      team_id: "T2",
      name: "Beta",
      url: null,
      default_channel: "C2",
      added_at: 1700000100,
    });

    const rows = workspaces.list(db);
    expect(rows.length).toBe(2);
    expect(rows[0]?.team_id).toBe("T1");
    expect(rows[1]?.team_id).toBe("T2");
    expect(rows[1]?.default_channel).toBe("C2");
  });

  test("setDefault updates default_channel", () => {
    workspaces.insert(db, {
      team_id: "T1",
      name: "Acme",
      url: null,
      default_channel: null,
      added_at: 1700000000,
    });
    workspaces.setDefault(db, "T1", "C42");
    expect(workspaces.list(db)[0]?.default_channel).toBe("C42");

    workspaces.setDefault(db, "T1", null);
    expect(workspaces.list(db)[0]?.default_channel).toBeNull();
  });

  test("remove deletes the row", () => {
    workspaces.insert(db, {
      team_id: "T1",
      name: "Acme",
      url: null,
      default_channel: null,
      added_at: 1700000000,
    });
    workspaces.remove(db, "T1");
    expect(workspaces.list(db).length).toBe(0);
  });
});
