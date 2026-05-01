import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import type { Effects } from "../../../../src/cli/commands/stats/effects.ts";
import { statsHandler } from "../../../../src/cli/commands/stats/handler.ts";
import { UserError } from "../../../../src/cli/errors.ts";
import type { CommandContext } from "../../../../src/cli/router.ts";
import { StderrLogger } from "../../../../src/output/logger.ts";
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
  db: Database;
  stdout: NodeJS.WritableStream;
  dbPath?: string;
  statBytes?: (path: string) => number;
}

function makeEffects(opts: TestEffectsOpts): Effects {
  return {
    configDir: "/tmp/unused",
    env: {},
    openDb: () => opts.db,
    dbPath: opts.dbPath ?? ":memory:",
    statBytes: opts.statBytes ?? (() => 0),
    stdout: opts.stdout,
    now: () => 1700000000,
  };
}

function readBuffer(stream: PassThrough): string {
  let s = "";
  for (let chunk: unknown = stream.read(); chunk !== null; chunk = stream.read()) {
    s += String(chunk);
  }
  return s;
}

function seedWorkspaces(
  db: Database,
  ws: Array<{ team_id: string; name: string; added_at: number }>,
): void {
  for (const w of ws) {
    workspacesDao.upsert(db, {
      team_id: w.team_id,
      name: w.name,
      url: null,
      default_channel: null,
      added_at: w.added_at,
    });
  }
}

describe("statsHandler", () => {
  let db: Database;
  let stdout: PassThrough;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
    stdout = new PassThrough();
  });

  afterEach(() => {
    db.close();
  });

  it("(1) --workspace=T01ABCDEF で 1 行のみ JSONL", async () => {
    seedWorkspaces(db, [
      { team_id: "T01ABCDEF", name: "Acme", added_at: 1700000000 },
      { team_id: "T02OTHER", name: "Other", added_at: 1700000100 },
    ]);
    const ctx = makeCtx({ workspace: "T01ABCDEF" });
    const code = await statsHandler(ctx, makeEffects({ db, stdout }));
    expect(code).toBe(0);
    const out = readBuffer(stdout);
    const lines = out.trim().split("\n");
    expect(lines.length).toBe(1);
    const rec = JSON.parse(lines[0] as string);
    expect(rec.team_id).toBe("T01ABCDEF");
    expect(rec.name).toBe("Acme");
  });

  it("(2) ctx.workspace=null で全 workspace 2 行（added_at ASC）", async () => {
    seedWorkspaces(db, [
      { team_id: "T02OTHER", name: "Other", added_at: 1700000100 },
      { team_id: "T01ABCDEF", name: "Acme", added_at: 1700000000 },
    ]);
    const ctx = makeCtx({ workspace: null });
    const code = await statsHandler(ctx, makeEffects({ db, stdout }));
    expect(code).toBe(0);
    const lines = readBuffer(stdout).trim().split("\n");
    expect(lines.length).toBe(2);
    const r1 = JSON.parse(lines[0] as string);
    const r2 = JSON.parse(lines[1] as string);
    expect(r1.team_id).toBe("T01ABCDEF"); // added_at が小さいほうが先
    expect(r2.team_id).toBe("T02OTHER");
  });

  it("(3) --workspace=T_unknown が未登録なら UserError", async () => {
    seedWorkspaces(db, [{ team_id: "T01ABCDEF", name: "Acme", added_at: 1700000000 }]);
    const ctx = makeCtx({ workspace: "T9UNKNOWN" });
    try {
      await statsHandler(ctx, makeEffects({ db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("is not registered");
    }
  });

  it("(4a) --human は KV 整形で出力 (Workspace ヘッダ + Channels/Users/DB size 等)", async () => {
    seedWorkspaces(db, [{ team_id: "T01ABCDEF", name: "Acme", added_at: 1700000000 }]);
    const prevTty = (process.stdout as { isTTY?: boolean }).isTTY;
    const prevNo = process.env.NO_COLOR;
    const prevSlackNo = process.env.SLACK_CHAN_NO_COLOR;
    delete process.env.NO_COLOR;
    delete process.env.SLACK_CHAN_NO_COLOR;
    Object.defineProperty(process.stdout, "isTTY", { value: true, configurable: true });
    try {
      const ctx = makeCtx({ workspace: "T01ABCDEF", format: "human" });
      const code = await statsHandler(ctx, makeEffects({ db, stdout }));
      expect(code).toBe(0);
      const out = readBuffer(stdout);
      // 旧仕様 (pretty JSON) の `"team_id":` は出ない
      expect(out).not.toContain('"team_id":');
      // 新仕様: Workspace ヘッダ + KV
      expect(out).toContain("Workspace");
      expect(out).toContain("T01ABCDEF");
      expect(out).toContain("Acme");
      expect(out).toContain("Channels");
      expect(out).toContain("Messages");
      expect(out).toContain("Users");
      expect(out).toContain("Files");
      expect(out).toContain("DB size");
      // bold (Workspace 太字) の ANSI escape が入る
      const ESC = String.fromCharCode(0x1b);
      expect(out.includes(`${ESC}[1m`)).toBe(true);
    } finally {
      Object.defineProperty(process.stdout, "isTTY", { value: prevTty, configurable: true });
      if (prevNo !== undefined) process.env.NO_COLOR = prevNo;
      if (prevSlackNo !== undefined) process.env.SLACK_CHAN_NO_COLOR = prevSlackNo;
    }
  });

  it("(4b) --toon は jsonl 互換 (現状)", async () => {
    seedWorkspaces(db, [{ team_id: "T01ABCDEF", name: "Acme", added_at: 1700000000 }]);
    const ctx = makeCtx({ workspace: "T01ABCDEF", format: "toon" });
    const code = await statsHandler(ctx, makeEffects({ db, stdout }));
    expect(code).toBe(0);
    const out = readBuffer(stdout);
    // JsonlFormatter 委譲なので、行末改行付き JSON
    const rec = JSON.parse(out.trim());
    expect(rec.team_id).toBe("T01ABCDEF");
  });

  it("(5) effects.statBytes が呼ばれて db_size_bytes に反映", async () => {
    seedWorkspaces(db, [{ team_id: "T01ABCDEF", name: "Acme", added_at: 1700000000 }]);
    const ctx = makeCtx({ workspace: "T01ABCDEF" });
    const code = await statsHandler(
      ctx,
      makeEffects({ db, stdout, dbPath: "/tmp/fake-cache.db", statBytes: () => 9999 }),
    );
    expect(code).toBe(0);
    const rec = JSON.parse(readBuffer(stdout).trim());
    expect(rec.db_size_bytes).toBe(9999);
  });

  it("(6) dbPath=':memory:' なら db_size_bytes=0 (statBytes 呼ばれない)", async () => {
    seedWorkspaces(db, [{ team_id: "T01ABCDEF", name: "Acme", added_at: 1700000000 }]);
    let called = false;
    const ctx = makeCtx({ workspace: "T01ABCDEF" });
    const code = await statsHandler(
      ctx,
      makeEffects({
        db,
        stdout,
        dbPath: ":memory:",
        statBytes: () => {
          called = true;
          return 9999;
        },
      }),
    );
    expect(code).toBe(0);
    expect(called).toBe(false);
    const rec = JSON.parse(readBuffer(stdout).trim());
    expect(rec.db_size_bytes).toBe(0);
  });

  it("(7) workspaces=0 件 (空 DB) のとき stdout が 0 行", async () => {
    const ctx = makeCtx({ workspace: null });
    const code = await statsHandler(ctx, makeEffects({ db, stdout }));
    expect(code).toBe(0);
    expect(readBuffer(stdout)).toBe("");
  });

  it("(8) Minor #3: 実 DB を temp path で開いた場合、WAL があっても db_size_bytes は main file size のみ", async () => {
    const dir = mkdtempSync(join(tmpdir(), "slack-chan-stats-wal-"));
    const dbPath = join(dir, "cache.db");
    const realDb = openDatabase({ path: dbPath });
    try {
      // workspace を seed
      workspacesDao.upsert(realDb, {
        team_id: "T01ABCDEF",
        name: "Acme",
        url: null,
        default_channel: null,
        added_at: 1700000000,
      });
      // WAL を作るために CREATE TABLE 等を走らせて変更を入れる
      realDb.exec("CREATE TABLE _wal_probe (x INTEGER);");
      realDb.exec("INSERT INTO _wal_probe VALUES (1);");

      const fs = await import("node:fs");
      const mainSize = fs.statSync(dbPath).size;

      // 実 effects を使う（fs.statSync 経由で main file size のみ）
      const realEffects: Effects = {
        configDir: "/tmp/unused",
        env: {},
        openDb: () => realDb,
        dbPath,
        statBytes: (p) => fs.statSync(p).size,
        stdout,
        now: () => 1700000000,
      };

      const ctx = makeCtx({ workspace: "T01ABCDEF" });
      const code = await statsHandler(ctx, realEffects);
      expect(code).toBe(0);
      const rec = JSON.parse(readBuffer(stdout).trim());
      expect(rec.db_size_bytes).toBe(mainSize);
    } finally {
      realDb.close();
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("(9) --workspace の team_id 形式が不正 → UserError 'must match'", async () => {
    seedWorkspaces(db, [{ team_id: "T01ABCDEF", name: "Acme", added_at: 1700000000 }]);
    const ctx = makeCtx({ workspace: "not-a-team-id" });
    try {
      await statsHandler(ctx, makeEffects({ db, stdout }));
      throw new Error("expected UserError");
    } catch (err) {
      expect(err).toBeInstanceOf(UserError);
      expect((err as Error).message).toContain("must match");
    }
  });
});
