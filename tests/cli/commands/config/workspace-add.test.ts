import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebClient } from "@slack/web-api";
import {
  defaultResolveDefaultTokensStore,
  type Effects,
} from "../../../../src/cli/commands/config/effects.ts";
import { workspaceAddHandler } from "../../../../src/cli/commands/config/workspace-add.ts";
import { TransientError, UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { loadConfig, saveConfig } from "../../../../src/config/io.ts";
import type { Config } from "../../../../src/config/types.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
import { MemoryTokenStore } from "../../../../src/secrets/memory-store.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
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

interface TestEffectsOpts {
  configDir: string;
  store?: MemoryTokenStore;
  db?: Database;
  platform?: NodeJS.Platform;
  authResult?: Record<string, unknown>;
  authThrow?: unknown;
  createTokenStoreSpy?: (kind: "keychain" | "file") => MemoryTokenStore;
}

function makeEffects(opts: TestEffectsOpts): Effects {
  const store = opts.store ?? new MemoryTokenStore();
  const db = opts.db ?? openDatabase({ path: ":memory:" });
  return {
    configDir: opts.configDir,
    env: {},
    platform: opts.platform ?? "linux",
    openDb: () => db,
    createTokenStore: opts.createTokenStoreSpy ?? (() => store),
    resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
    createSlackClient: (team_id, token) => {
      const client = new SlackClient({ team_id, token });
      // Override authTest at the instance level to keep tests fully isolated.
      Object.defineProperty(client, "authTest", {
        value: async () => {
          if (opts.authThrow !== undefined) throw opts.authThrow;
          return (
            opts.authResult ?? {
              ok: true,
              team_id: "T123",
              team: "Acme",
              url: "https://acme.slack.com/",
            }
          );
        },
      });
      return client;
    },
  };
}

describe("config workspace add", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-add-test-"));
  });

  afterEach(async () => {
    mock.restore();
    await rm(dir, { recursive: true, force: true });
  });

  it("(1) saves token + upserts workspaces row + writes config", async () => {
    const store = new MemoryTokenStore();
    const db = openDatabase({ path: ":memory:" });
    try {
      const code = await workspaceAddHandler(
        makeCtx({ rest: ["--token=xoxb-test-1234567890abcd"] }),
        makeEffects({ configDir: dir, store, db }),
      );
      expect(code).toBe(0);
      expect(await store.get("T123")).toBe("xoxb-test-1234567890abcd");
      const cfg = await loadConfig({ configDir: dir });
      expect(cfg.workspaces.T123?.name).toBe("Acme");
      expect(cfg.workspaces.T123?.tokens_store).toBe("file"); // platform: linux
      const row = workspacesDao.get(db, "T123");
      expect(row?.name).toBe("Acme");
      expect(row?.url).toBe("https://acme.slack.com/");
    } finally {
      db.close();
    }
  });

  // M-Inspect-2: 順序検証 — xoxc-/xoxd- は auth.test (= WebClient.apiCall) より前に
  // assertAllowedSlackToken で UserError として reject されるべき。makeEffects は
  // authTest を instance-level で override してしまい順序検出に使えないので、
  // ここでは実 SlackClient を用い、WebClient.prototype.apiCall を spy して
  // 「呼ばれていない」ことを assert する。
  for (const badToken of ["xoxc-stolen-12345", "xoxd-stolen-12345"]) {
    it(`(2) ${badToken} is rejected before auth.test is called (AUP guard)`, async () => {
      const proto = WebClient.prototype as unknown as {
        apiCall: (...args: unknown[]) => Promise<unknown>;
      };
      const apiCallSpy = spyOn(proto, "apiCall").mockResolvedValue({
        ok: true,
        team_id: "T_SHOULD_NOT_REACH",
        team: "ShouldNotReach",
        url: "https://nope.slack.com/",
      });

      const store = new MemoryTokenStore();
      const db = openDatabase({ path: ":memory:" });
      try {
        const effects: Effects = {
          configDir: dir,
          env: {},
          platform: "linux",
          openDb: () => db,
          createTokenStore: () => store,
          resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
          createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
        };
        await expect(
          workspaceAddHandler(makeCtx({ rest: [`--token=${badToken}`] }), effects),
        ).rejects.toThrow(/AUP|xoxc|xoxd/);
        // 順序検証の核心: auth.test (= WebClient.apiCall) が呼ばれていない
        expect(apiCallSpy).not.toHaveBeenCalled();
        // TokenStore にも保存されていない
        expect(await store.get("T_SHOULD_NOT_REACH")).toBeUndefined();
      } finally {
        db.close();
      }
    });
  }

  it("(3) auth.test returns ok:false → TransientError", async () => {
    const db = openDatabase({ path: ":memory:" });
    try {
      expect(
        workspaceAddHandler(
          makeCtx({ rest: ["--token=xoxb-test-1234567890abcd"] }),
          makeEffects({
            configDir: dir,
            db,
            authResult: { ok: false, error: "invalid_auth" },
          }),
        ),
      ).rejects.toBeInstanceOf(TransientError);
    } finally {
      db.close();
    }
  });

  it("(4) --name overrides auth.test team", async () => {
    const store = new MemoryTokenStore();
    const db = openDatabase({ path: ":memory:" });
    try {
      const code = await workspaceAddHandler(
        makeCtx({ rest: ["--token=xoxb-test-1234567890abcd", "--name=Custom Name"] }),
        makeEffects({ configDir: dir, store, db }),
      );
      expect(code).toBe(0);
      const cfg = await loadConfig({ configDir: dir });
      expect(cfg.workspaces.T123?.name).toBe("Custom Name");
    } finally {
      db.close();
    }
  });

  it("(5) re-adding an existing team_id upserts and preserves default_channel via DAO COALESCE", async () => {
    const store = new MemoryTokenStore();
    const db = openDatabase({ path: ":memory:" });
    try {
      // 既存の workspace + default_channel をセット
      const existingCfg: Config = {
        default_workspace: null,
        workspaces: {
          T123: { name: "Old", default_channel: "C-PRESERVE", tokens_store: "file" },
        },
        output: { format: "jsonl", cache_window_days: 7 },
      };
      await saveConfig(existingCfg, { configDir: dir });
      workspacesDao.insert(db, {
        team_id: "T123",
        name: "Old",
        url: null,
        default_channel: "C-PRESERVE",
        added_at: 1700000000,
      });

      const code = await workspaceAddHandler(
        makeCtx({ rest: ["--token=xoxb-test-1234567890abcd"] }),
        makeEffects({ configDir: dir, store, db }),
      );
      expect(code).toBe(0);
      const row = workspacesDao.get(db, "T123");
      expect(row?.default_channel).toBe("C-PRESERVE");
      expect(row?.added_at).toBe(1700000000); // 既存値保持
      expect(row?.name).toBe("Acme"); // auth.test の値で更新
      const cfg = await loadConfig({ configDir: dir });
      expect(cfg.workspaces.T123?.default_channel).toBe("C-PRESERVE");
    } finally {
      db.close();
    }
  });

  it("(6) first workspace tokens_store default: darwin → keychain, linux → file", async () => {
    {
      const store = new MemoryTokenStore();
      const db = openDatabase({ path: ":memory:" });
      try {
        const code = await workspaceAddHandler(
          makeCtx({ rest: ["--token=xoxb-test-1234567890abcd"] }),
          makeEffects({ configDir: dir, store, db, platform: "linux" }),
        );
        expect(code).toBe(0);
        const cfg = await loadConfig({ configDir: dir });
        expect(cfg.workspaces.T123?.tokens_store).toBe("file");
      } finally {
        db.close();
      }
    }
    // darwin の場合 — 別 dir で実行
    const dir2 = await mkdtemp(join(tmpdir(), "slack-chan-add-test-darwin-"));
    try {
      const store = new MemoryTokenStore();
      const db = openDatabase({ path: ":memory:" });
      const code = await workspaceAddHandler(
        makeCtx({ rest: ["--token=xoxb-test-1234567890abcd"] }),
        makeEffects({
          configDir: dir2,
          store,
          db,
          platform: "darwin",
          // resolveDefaultTokensStore は keychain を返すが、
          // createTokenStore は MemoryTokenStore を返すのでテストは安全
        }),
      );
      expect(code).toBe(0);
      const cfg = await loadConfig({ configDir: dir2 });
      expect(cfg.workspaces.T123?.tokens_store).toBe("keychain");
      db.close();
    } finally {
      await rm(dir2, { recursive: true, force: true });
    }
  });

  it("(7) --tokens-store conflicting with existing workspaces → UserError", async () => {
    // 既存 workspace は file
    const existingCfg: Config = {
      default_workspace: null,
      workspaces: {
        T999: { name: "Existing", default_channel: null, tokens_store: "file" },
      },
      output: { format: "jsonl", cache_window_days: 7 },
    };
    await saveConfig(existingCfg, { configDir: dir });

    const store = new MemoryTokenStore();
    const db = openDatabase({ path: ":memory:" });
    try {
      expect(
        workspaceAddHandler(
          makeCtx({ rest: ["--token=xoxb-test-1234567890abcd", "--tokens-store=keychain"] }),
          makeEffects({ configDir: dir, store, db }),
        ),
      ).rejects.toBeInstanceOf(UserError);
    } finally {
      db.close();
    }
  });

  it("--token missing throws UserError", async () => {
    expect(
      workspaceAddHandler(makeCtx({ rest: [] }), makeEffects({ configDir: dir })),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("uses WebClient.prototype.apiCall fallback when SlackClient is constructed via defaultEffects (smoke)", async () => {
    // 真の defaultEffects と同様に SlackClient.authTest 内部の WebClient.apiCall を spy する
    const proto = WebClient.prototype as unknown as {
      apiCall: (...args: unknown[]) => Promise<unknown>;
    };
    spyOn(proto, "apiCall").mockResolvedValue({
      ok: true,
      team_id: "TSPY01",
      team: "SpyTeam",
      url: "https://spy.slack.com/",
    });

    const store = new MemoryTokenStore();
    const db = openDatabase({ path: ":memory:" });
    try {
      const effects: Effects = {
        configDir: dir,
        env: {},
        platform: "linux",
        openDb: () => db,
        createTokenStore: () => store,
        resolveDefaultTokensStore: defaultResolveDefaultTokensStore,
        createSlackClient: (team_id, token) => new SlackClient({ team_id, token }),
      };
      const code = await workspaceAddHandler(
        makeCtx({ rest: ["--token=xoxb-test-1234567890abcd"] }),
        effects,
      );
      expect(code).toBe(0);
      expect(await store.get("TSPY01")).toBe("xoxb-test-1234567890abcd");
    } finally {
      db.close();
    }
  });
});
