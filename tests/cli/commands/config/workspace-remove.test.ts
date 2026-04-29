import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultResolveDefaultTokensStore,
  type Effects,
} from "../../../../src/cli/commands/config/effects.ts";
import { workspaceRemoveHandler } from "../../../../src/cli/commands/config/workspace-remove.ts";
import { UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { loadConfig, saveConfig } from "../../../../src/config/io.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as channelsDao from "../../../../src/storage/dao/channels.ts";
import * as filesDao from "../../../../src/storage/dao/files.ts";
import * as messagesDao from "../../../../src/storage/dao/messages.ts";
import * as usersDao from "../../../../src/storage/dao/users.ts";
import * as workspacesDao from "../../../../src/storage/dao/workspaces.ts";
import { openDatabase } from "../../../../src/storage/db.ts";

function makeCtx(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    workspace: null,
    format: "jsonl",
    verbose: false,
    rest: [],
    logger: new StderrLogger(),
    ...overrides,
  };
}

interface MakeOpts {
  configDir: string;
  store?: MemoryTokenStore;
  db?: ReturnType<typeof openDatabase>;
}

function makeEffects(opts: MakeOpts): Effects {
  const store = opts.store ?? new MemoryTokenStore();
  const db = opts.db ?? openDatabase({ path: ":memory:" });
  return {
    configDir: opts.configDir,
    env: {},
    platform: "linux",
    openDb: () => db,
    createTokenStore: () => store,
    resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
    createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
  };
}

const baseConfig: Config = {
  default_workspace: "T01ABCDEF",
  workspaces: {
    T01ABCDEF: { name: "Acme", default_channel: null, tokens_store: "file" },
  },
  output: { format: "jsonl", cache_window_days: 7 },
};

function seedDb(db: ReturnType<typeof openDatabase>, team_id: string): void {
  workspacesDao.insert(db, {
    team_id,
    name: "Acme",
    url: null,
    default_channel: null,
    added_at: 1700000000,
  });
  channelsDao.upsert(db, {
    team_id,
    channel_id: "C1",
    name: "general",
    type: "public_channel",
    topic: null,
    purpose: null,
    is_member: 1,
    last_synced_ts: null,
    fetched_at: 1700000000,
  });
  messagesDao.upsert(db, {
    team_id,
    channel_id: "C1",
    ts: "1700000000.000100",
    thread_ts: null,
    user_id: "U1",
    type: "message",
    subtype: null,
    text: "hi",
    edited_ts: null,
    raw_json: '{"text":"hi"}',
    fetched_at: 1700000050,
  });
  usersDao.upsert(db, {
    team_id,
    user_id: "U1",
    name: "alice",
    real_name: "Alice",
    email: null,
    profile_json: null,
    fetched_at: 1700000000,
  });
  filesDao.upsert(db, {
    team_id,
    file_id: "F1",
    channel_id: "C1",
    ts: null,
    name: "x.png",
    mimetype: "image/png",
    size: 10,
    url_private: null,
    local_path: null,
    downloaded_at: null,
    raw_json: '{"id":"F1"}',
  });
}

describe("config workspace remove", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-remove-test-"));
  });

  afterEach(async () => {
    mock.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it("(1) --yes runs DB tx → config remove → TokenStore.delete in order", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const store = new MemoryTokenStore();
    await store.set("T01ABCDEF", "xoxb-test-1234567890abcd");
    const db = openDatabase({ path: ":memory:" });
    seedDb(db, "T01ABCDEF");

    const code = await workspaceRemoveHandler(
      makeCtx({ rest: ["T01ABCDEF", "--yes"] }),
      makeEffects({ configDir: dir, store, db }),
    );
    expect(code).toBe(0);

    // DB
    expect(workspacesDao.get(db, "T01ABCDEF")).toBeNull();
    const chCount = db
      .query<{ n: number }, [string]>("SELECT COUNT(*) AS n FROM channels WHERE team_id = ?")
      .get("T01ABCDEF");
    expect(chCount?.n).toBe(0);

    // Config
    const cfg = await loadConfig({ configDir: dir });
    expect("T01ABCDEF" in cfg.workspaces).toBe(false);
    expect(cfg.default_workspace).toBeNull();

    // TokenStore
    expect(await store.get("T01ABCDEF")).toBeUndefined();

    db.close();
  });

  it("(2) without --yes and TTY=false → UserError", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(
      workspaceRemoveHandler(makeCtx({ rest: ["T01ABCDEF"] }), makeEffects({ configDir: dir })),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("(4) team_id 未登録 → warning + EXIT_OK", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const code = await workspaceRemoveHandler(
      makeCtx({ rest: ["T99NOTHERE", "--yes"] }),
      makeEffects({ configDir: dir }),
    );
    expect(code).toBe(0);
  });

  it("(5) TokenStore.delete throws but exit code is still 0 (best-effort)", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const store = new MemoryTokenStore();
    await store.set("T01ABCDEF", "xoxb-test-1234567890abcd");
    // Override delete to throw
    Object.defineProperty(store, "delete", {
      value: async () => {
        throw new Error("simulated keychain failure");
      },
    });

    const db = openDatabase({ path: ":memory:" });
    seedDb(db, "T01ABCDEF");

    const code = await workspaceRemoveHandler(
      makeCtx({ rest: ["T01ABCDEF", "--yes"] }),
      makeEffects({ configDir: dir, store, db }),
    );
    expect(code).toBe(0);
    // DB tx + config remove はちゃんと完了している
    expect(workspacesDao.get(db, "T01ABCDEF")).toBeNull();
    const cfg = await loadConfig({ configDir: dir });
    expect("T01ABCDEF" in cfg.workspaces).toBe(false);
    db.close();
  });

  it("(6) DB tx failure → config / TokenStore unchanged (recoverable)", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const store = new MemoryTokenStore();
    await store.set("T01ABCDEF", "xoxb-test-1234567890abcd");
    const db = openDatabase({ path: ":memory:" });
    seedDb(db, "T01ABCDEF");
    db.close(); // 強制的に close → tx で例外

    expect(
      workspaceRemoveHandler(
        makeCtx({ rest: ["T01ABCDEF", "--yes"] }),
        makeEffects({ configDir: dir, store, db }),
      ),
    ).rejects.toThrow();

    // config は無傷
    const cfg = await loadConfig({ configDir: dir });
    expect("T01ABCDEF" in cfg.workspaces).toBe(true);
    // TokenStore も無傷
    expect(await store.get("T01ABCDEF")).toBe("xoxb-test-1234567890abcd");
  });
});
