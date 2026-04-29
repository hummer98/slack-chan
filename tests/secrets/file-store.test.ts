import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  chmod,
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
import { FileTokenStore } from "../../src/secrets/file-store.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slack-chan-file-store-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("FileTokenStore — round-trip & guard wiring", () => {
  it("round-trips set / get / delete / list for an xoxp- token", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await store.set("T0001", "xoxp-test-token-aaaa");
    expect(await store.get("T0001")).toBe("xoxp-test-token-aaaa");
    expect(await store.list()).toEqual(["T0001"]);
    await store.delete("T0001");
    expect(await store.get("T0001")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("get returns undefined when the store has never been initialized", async () => {
    const store = new FileTokenStore({ configDir: dir });
    expect(await store.get("T0001")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("rejects xoxc- (Slack AUP) at set()", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await expect(store.set("T0001", "xoxc-stolen-token")).rejects.toThrow(/Slack AUP/);
    expect(await store.list()).toEqual([]);
  });

  it("rejects xoxd- (Slack AUP) at set()", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await expect(store.set("T0001", "xoxd-stolen-token")).rejects.toThrow(/Slack AUP/);
  });

  it("delete on a missing team_id is a no-op", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await store.set("T0001", "xoxp-x-aaaa");
    await store.delete("T9999");
    expect((await store.list()).sort()).toEqual(["T0001"]);
  });
});

describe("FileTokenStore — file mode enforcement", () => {
  it("creates tokens.json with mode 0o600 and parent dir 0o700", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await store.set("T0001", "xoxp-test-token-aaaa");
    const f = await stat(join(dir, "tokens.json"));
    expect(f.mode & 0o777).toBe(0o600);
    const d = await stat(dir);
    expect(d.mode & 0o777).toBe(0o700);
  });

  it("throws if tokens.json mode is unsafe (0o644) on read", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await store.set("T0001", "xoxp-test-token-aaaa");
    await chmod(join(dir, "tokens.json"), 0o644);
    await expect(store.get("T0001")).rejects.toThrow(/chmod 600/);
  });

  it("throws if parent dir mode is unsafe (0o755) on read", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await store.set("T0001", "xoxp-test-token-aaaa");
    await chmod(dir, 0o755);
    await expect(store.get("T0001")).rejects.toThrow(/chmod 700/);
  });
});

describe("FileTokenStore — atomic write & tempfile hygiene", () => {
  it("leaves no .tmp residue after a successful set()", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await store.set("T0001", "xoxp-aaaa-bbbb-cccc");
    const entries = await readdir(dir);
    expect(entries.some((n) => n.endsWith(".tmp"))).toBe(false);
  });

  it("cleans up stale .tmp files (24h+) on next write (M3)", async () => {
    const stale = join(dir, "tokens.json.999.deadbeef.tmp");
    await writeFile(stale, "stale", { mode: 0o600 });
    const ancient = new Date(Date.now() - 25 * 60 * 60 * 1000);
    await utimes(stale, ancient, ancient);

    const store = new FileTokenStore({ configDir: dir });
    await store.set("T0001", "xoxp-aaaa-bbbb-cccc");

    const entries = await readdir(dir);
    expect(entries).not.toContain("tokens.json.999.deadbeef.tmp");
  });
});

describe("FileTokenStore — symlink rejection (M1)", () => {
  it("throws when tokens.json is a symlink (read)", async () => {
    const real = join(dir, "real.json");
    await writeFile(real, JSON.stringify({ T0001: "xoxp-stolen" }), { mode: 0o600 });
    await symlink(real, join(dir, "tokens.json"));
    const store = new FileTokenStore({ configDir: dir });
    await expect(store.get("T0001")).rejects.toThrow(/symlink/);
  });

  it("throws when tokens.json is a symlink (write)", async () => {
    const real = join(dir, "real.json");
    await writeFile(real, "{}", { mode: 0o600 });
    await symlink(real, join(dir, "tokens.json"));
    const store = new FileTokenStore({ configDir: dir });
    await expect(store.set("T0001", "xoxp-test-aaaa")).rejects.toThrow(/symlink/);
  });
});

describe("FileTokenStore — JSON parse-error fail-closed (M2)", () => {
  it("throws on get() when tokens.json is corrupt", async () => {
    await writeFile(join(dir, "tokens.json"), "{ broken", { mode: 0o600 });
    await chmod(dir, 0o700);
    const store = new FileTokenStore({ configDir: dir });
    await expect(store.get("T0001")).rejects.toThrow(/tokens\.json/);
  });

  it("refuses to overwrite when tokens.json is corrupt", async () => {
    await writeFile(join(dir, "tokens.json"), "{ broken", { mode: 0o600 });
    await chmod(dir, 0o700);
    const store = new FileTokenStore({ configDir: dir });
    await expect(store.set("T0001", "xoxp-test-aaaa")).rejects.toThrow(/tokens\.json/);
    // Damaged file must remain intact.
    const stillBroken = await readFile(join(dir, "tokens.json"), "utf8");
    expect(stillBroken).toBe("{ broken");
  });
});

describe("FileTokenStore — team_id validation (M5)", () => {
  it("rejects argv-injection-style ids", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await expect(store.set("-foo", "xoxp-test-aaaa")).rejects.toThrow(/team_id/);
    await expect(store.get("-foo")).rejects.toThrow(/team_id/);
    await expect(store.delete("-foo")).rejects.toThrow(/team_id/);
  });

  it("rejects empty / lowercase / wrong prefix", async () => {
    const store = new FileTokenStore({ configDir: dir });
    await expect(store.set("", "xoxp-test-aaaa")).rejects.toThrow(/team_id/);
    await expect(store.set("foo", "xoxp-test-aaaa")).rejects.toThrow(/team_id/);
  });
});

describe("FileTokenStore — error message redaction", () => {
  it("error.message never contains the raw token (xoxc rejected at set)", async () => {
    const raw = "xoxc-very-very-secret-token-do-not-leak";
    const store = new FileTokenStore({ configDir: dir });
    let err: Error | undefined;
    try {
      await store.set("T0001", raw);
    } catch (e) {
      err = e as Error;
    }
    expect(err).toBeDefined();
    // The full raw token must not appear; redaction or a generic AUP wording
    // is fine.
    expect(err?.message).not.toContain("very-very-secret-token-do-not-leak");
  });
});
