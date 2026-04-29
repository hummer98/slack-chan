import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmod,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  stat,
  symlink,
  utimes,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  assertValidTeamId,
  cleanupStaleTempFiles,
  readIndex,
  writeIndex,
} from "../../src/secrets/index-file.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slack-chan-index-test-"));
  // The dir helpers expect us to point at a config dir; we use the tmp dir
  // *as if it were* `$XDG_CONFIG_HOME/slack-chan`.
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("assertValidTeamId", () => {
  it("accepts T-prefixed uppercase alphanumerics up to 32 chars", () => {
    expect(() => assertValidTeamId("T01ABCDEF")).not.toThrow();
    expect(() => assertValidTeamId("T0")).not.toThrow();
    expect(() => assertValidTeamId(`T${"A".repeat(32)}`)).not.toThrow();
  });

  it("rejects argv-injection attempts (leading dash)", () => {
    expect(() => assertValidTeamId("-foo")).toThrow(/team_id/);
    expect(() => assertValidTeamId("--service")).toThrow(/team_id/);
  });

  it("rejects empty / lowercase / wrong prefix / over-length", () => {
    expect(() => assertValidTeamId("")).toThrow(/team_id/);
    expect(() => assertValidTeamId("t01abcdef")).toThrow(/team_id/);
    expect(() => assertValidTeamId("U0123")).toThrow(/team_id/);
    expect(() => assertValidTeamId(`T${"A".repeat(33)}`)).toThrow(/team_id/);
  });

  it("rejects non-string input without leaking it (logger safety)", () => {
    const f = assertValidTeamId as unknown as (x: unknown) => void;
    expect(() => f(undefined)).toThrow(/team_id/);
    expect(() => f(123)).toThrow(/team_id/);
  });
});

describe("readIndex", () => {
  it("returns [] when the index.json does not exist (first run)", async () => {
    expect(await readIndex(dir)).toEqual([]);
  });

  it("round-trips a written index", async () => {
    await writeIndex(dir, ["T0001", "T0002"]);
    expect((await readIndex(dir)).sort()).toEqual(["T0001", "T0002"]);
  });

  it("throws when index.json mode allows group/other access (e.g. 0644)", async () => {
    await writeIndex(dir, ["T0001"]);
    const path = join(dir, "index.json");
    await chmod(path, 0o644);
    await expect(readIndex(dir)).rejects.toThrow(/chmod 600/);
  });

  it("throws when parent dir mode allows group/other access (e.g. 0755)", async () => {
    await writeIndex(dir, ["T0001"]);
    await chmod(dir, 0o755);
    await expect(readIndex(dir)).rejects.toThrow(/chmod 700/);
  });

  it("throws when index.json is a symlink (M1)", async () => {
    const real = join(dir, "real.json");
    await writeFile(real, JSON.stringify(["T0001"]), { mode: 0o600 });
    await symlink(real, join(dir, "index.json"));
    await expect(readIndex(dir)).rejects.toThrow(/symlink/);
  });

  it("throws when parent dir is a symlink (M1)", async () => {
    const real = join(tmpdir(), `slack-chan-real-${process.pid}-${Date.now()}`);
    await mkdir(real, { mode: 0o700 });
    const linkDir = join(tmpdir(), `slack-chan-link-${process.pid}-${Date.now()}`);
    await symlink(real, linkDir);
    try {
      await expect(readIndex(linkDir)).rejects.toThrow(/symlink/);
    } finally {
      await rm(linkDir, { force: true }).catch(() => {});
      await rm(real, { recursive: true, force: true });
    }
  });

  it("fail-closed: JSON parse error throws with a redacted path (M2)", async () => {
    const path = join(dir, "index.json");
    await writeFile(path, "{ not valid json", { mode: 0o600 });
    let err: Error | undefined;
    try {
      await readIndex(dir);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    // The error message should not leak the file contents (fail-closed).
    expect(err?.message).not.toContain("not valid json");
    expect(err?.message).toMatch(/index\.json/);
  });
});

describe("writeIndex", () => {
  it("creates the parent dir with mode 0700 if it does not exist", async () => {
    const sub = join(dir, "nested");
    await writeIndex(sub, ["T0001"]);
    const s = await stat(sub);
    expect(s.mode & 0o777).toBe(0o700);
    const f = await stat(join(sub, "index.json"));
    expect(f.mode & 0o777).toBe(0o600);
  });

  it("overwrites an existing index atomically (no .tmp residue)", async () => {
    await writeIndex(dir, ["T0001"]);
    await writeIndex(dir, ["T0002", "T0003"]);
    const after = await readdir(dir);
    expect(after.some((n) => n.endsWith(".tmp"))).toBe(false);
    const data = JSON.parse(await readFile(join(dir, "index.json"), "utf8"));
    expect(data.sort()).toEqual(["T0002", "T0003"]);
  });

  it("forces 0o600 on the resulting file even if a stale 0644 file existed", async () => {
    const path = join(dir, "index.json");
    await writeFile(path, JSON.stringify(["T0001"]), { mode: 0o644 });
    await writeIndex(dir, ["T0002"]);
    const s = await stat(path);
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("fail-closed: refuses to write when existing index.json is corrupt JSON (M2)", async () => {
    const path = join(dir, "index.json");
    await writeFile(path, "{ broken", { mode: 0o600 });
    await expect(writeIndex(dir, ["T0001"])).rejects.toThrow(/index\.json/);
    // The existing broken file must not be replaced.
    const stillBroken = await readFile(path, "utf8");
    expect(stillBroken).toBe("{ broken");
  });

  it("throws when index.json is a symlink (M1, write side TOCTOU)", async () => {
    const real = join(dir, "attacker.json");
    await writeFile(real, JSON.stringify(["x"]), { mode: 0o600 });
    await symlink(real, join(dir, "index.json"));
    await expect(writeIndex(dir, ["T0001"])).rejects.toThrow(/symlink/);
  });
});

describe("cleanupStaleTempFiles (M3)", () => {
  it("removes index.json.* and tokens.json.* tempfiles older than 24h", async () => {
    const oldTmp1 = join(dir, "index.json.999.aaa.tmp");
    const oldTmp2 = join(dir, "tokens.json.123.bbb.tmp");
    await writeFile(oldTmp1, "stale", { mode: 0o600 });
    await writeFile(oldTmp2, "stale", { mode: 0o600 });
    const ancient = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(oldTmp1, ancient, ancient);
    await utimes(oldTmp2, ancient, ancient);
    await cleanupStaleTempFiles(dir);
    const left = await readdir(dir);
    expect(left).not.toContain("index.json.999.aaa.tmp");
    expect(left).not.toContain("tokens.json.123.bbb.tmp");
  });

  it("preserves recent tempfiles (a same-process write in flight)", async () => {
    const recent = join(dir, "index.json.1.fresh.tmp");
    await writeFile(recent, "in-flight", { mode: 0o600 });
    await cleanupStaleTempFiles(dir);
    const left = await readdir(dir);
    expect(left).toContain("index.json.1.fresh.tmp");
  });

  it("ignores non-tempfile noise (e.g. backups, README)", async () => {
    const keep = join(dir, "README.txt");
    await writeFile(keep, "hello", { mode: 0o600 });
    const ancient = new Date(Date.now() - 30 * 60 * 60 * 1000);
    await utimes(keep, ancient, ancient);
    await cleanupStaleTempFiles(dir);
    const left = await readdir(dir);
    expect(left).toContain("README.txt");
  });

  it("is best-effort: missing dir does not throw", async () => {
    await expect(cleanupStaleTempFiles(join(dir, "no-such-dir"))).resolves.toBeUndefined();
  });
});
