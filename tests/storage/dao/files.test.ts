import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as files from "../../../src/storage/dao/files.ts";
import { openDatabase } from "../../../src/storage/db.ts";
import type { FileRow } from "../../../src/storage/types.ts";

function makeFile(overrides: Partial<FileRow> = {}): FileRow {
  return {
    team_id: "T1",
    file_id: "F1",
    channel_id: "C1",
    ts: "1700000000.000100",
    name: "image.png",
    mimetype: "image/png",
    size: 1024,
    url_private: "https://files.slack.com/F1",
    local_path: null,
    downloaded_at: null,
    raw_json: '{"id":"F1"}',
    ...overrides,
  };
}

describe("dao/files", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  test("upsert + get round-trips", () => {
    const row = makeFile();
    files.upsert(db, row);
    expect(files.get(db, "T1", "F1")).toEqual(row);
  });

  test("get returns null for missing file", () => {
    expect(files.get(db, "T1", "F-missing")).toBeNull();
  });

  test("markDownloaded sets local_path and downloaded_at", () => {
    files.upsert(db, makeFile());
    files.markDownloaded(db, "T1", "F1", "/abs/path/F1", 1700000999);

    const row = files.get(db, "T1", "F1");
    expect(row?.local_path).toBe("/abs/path/F1");
    expect(row?.downloaded_at).toBe(1700000999);
  });

  test("re-upsert after markDownloaded keeps local_path / downloaded_at (Recommendation 1 と同質の保護)", () => {
    files.upsert(db, makeFile());
    files.markDownloaded(db, "T1", "F1", "/abs/path/F1", 1700000999);

    files.upsert(
      db,
      makeFile({ local_path: null, downloaded_at: null, raw_json: '{"id":"F1","v":2}' }),
    );

    const row = files.get(db, "T1", "F1");
    expect(row?.local_path).toBe("/abs/path/F1");
    expect(row?.downloaded_at).toBe(1700000999);
    expect(row?.raw_json).toBe('{"id":"F1","v":2}');
  });
});
