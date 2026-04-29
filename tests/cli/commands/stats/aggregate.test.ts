import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { aggregateWorkspace } from "../../../../src/cli/commands/stats/aggregate.ts";
import * as channelsDao from "../../../../src/storage/dao/channels.ts";
import * as filesDao from "../../../../src/storage/dao/files.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import * as usersDao from "../../../../src/storage/dao/users.ts";
import * as workspacesDao from "../../../../src/storage/dao/workspaces.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

describe("aggregateWorkspace", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("fixture から StatsRecord を組み立てる (channels 3 件 / messages alive 4・total 5 / users 2 / files 1)", () => {
    workspacesDao.upsert(db, {
      team_id: "T01ABCDEF",
      name: "Acme",
      url: null,
      default_channel: null,
      added_at: 1700000000,
    });
    const ws = workspacesDao.get(db, "T01ABCDEF");
    if (ws === null) throw new Error("seed failure");

    // channels: member=1 1 件 / member=0 1 件 / member=null 1 件 = 計 3
    channelsDao.upsert(db, {
      team_id: "T01ABCDEF",
      channel_id: "C1",
      name: "general",
      type: null,
      topic: null,
      purpose: null,
      is_member: 1,
      last_synced_ts: "1700000000.000200",
      fetched_at: 1700000000,
    });
    channelsDao.upsert(db, {
      team_id: "T01ABCDEF",
      channel_id: "C2",
      name: "random",
      type: null,
      topic: null,
      purpose: null,
      is_member: 0,
      last_synced_ts: "1700000000.000100",
      fetched_at: 1700000000,
    });
    channelsDao.upsert(db, {
      team_id: "T01ABCDEF",
      channel_id: "C3",
      name: "unknown",
      type: null,
      topic: null,
      purpose: null,
      is_member: null,
      last_synced_ts: null,
      fetched_at: 1700000000,
    });

    // messages: alive 4 件 + deleted 1 件 = total 5
    for (let i = 0; i < 5; i++) {
      messagesDao.upsert(db, {
        team_id: "T01ABCDEF",
        channel_id: "C1",
        ts: `170000000${i}.000000`, // 1700000000.000000 .. 1700000004.000000
        thread_ts: null,
        user_id: "U1",
        type: "message",
        subtype: null,
        text: `m${i}`,
        edited_ts: null,
        raw_json: "{}",
        fetched_at: 1700000000,
      });
    }
    messagesDao.markDeleted(db, "T01ABCDEF", "C1", "1700000004.000000");

    // users: 2 件
    usersDao.upsert(db, {
      team_id: "T01ABCDEF",
      user_id: "U1",
      name: "alice",
      real_name: null,
      email: null,
      profile_json: null,
      fetched_at: 1700000000,
    });
    usersDao.upsert(db, {
      team_id: "T01ABCDEF",
      user_id: "U2",
      name: "bob",
      real_name: null,
      email: null,
      profile_json: null,
      fetched_at: 1700000000,
    });

    // files: 1 件
    filesDao.upsert(db, {
      team_id: "T01ABCDEF",
      file_id: "F1",
      channel_id: "C1",
      ts: "1700000000.000000",
      name: "a.png",
      mimetype: null,
      size: null,
      url_private: null,
      local_path: null,
      downloaded_at: null,
      raw_json: null,
    });

    const rec = aggregateWorkspace(db, ws, 12345);
    expect(rec).toEqual({
      team_id: "T01ABCDEF",
      name: "Acme",
      channels_total: 3,
      channels_member: 1,
      messages_total: 5,
      messages_alive: 4,
      users: 2,
      files: 1,
      last_synced_ts: "1700000000.000200",
      db_size_bytes: 12345,
    });
  });
});
