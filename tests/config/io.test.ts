import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { copyFile, lstat, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { loadConfig, saveConfig } from "../../src/config/io.ts";
import type { Config } from "../../src/config/types.ts";
import { DEFAULTS } from "../../src/config/types.ts";

const FIXTURE_DIR = resolve(import.meta.dir, "../fixtures/config");

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slack-chan-config-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("loadConfig", () => {
  it("returns DEFAULTS when the file does not exist", async () => {
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.default_workspace).toBeNull();
    expect(cfg.workspaces).toEqual({});
    expect(cfg.output).toEqual(DEFAULTS.output);
  });

  it("parses a fully-populated fixture", async () => {
    await copyFile(join(FIXTURE_DIR, "valid.toml"), join(dir, "config.toml"));
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.default_workspace).toBe("T01ABCDEF");
    expect(cfg.workspaces.T01ABCDEF).toEqual({
      name: "Acme",
      default_channel: "C0123456",
      tokens_store: "keychain",
    });
    // Empty default_channel is normalised to null.
    expect(cfg.workspaces.T02XYZ).toEqual({
      name: "Personal",
      default_channel: null,
      tokens_store: "file",
    });
    expect(cfg.output).toEqual({ format: "jsonl", cache_window_days: 7 });
  });

  it("throws on a malformed TOML file (and never quotes raw content)", async () => {
    const malformedPath = join(dir, "config.toml");
    await copyFile(join(FIXTURE_DIR, "malformed.toml"), malformedPath);
    let caught: Error | undefined;
    try {
      await loadConfig({ configDir: dir });
    } catch (err) {
      caught = err as Error;
    }
    expect(caught).toBeDefined();
    expect(caught?.message).toContain(malformedPath);
    expect(caught?.message).toContain("fail-closed");
    // The raw file content must not be echoed back in the error message.
    const raw = await readFile(malformedPath, "utf8");
    expect(caught?.message).not.toContain(raw);
  });

  it("throws when [workspace.<id>] is missing required `name`", async () => {
    await writeFile(
      join(dir, "config.toml"),
      `[workspace.T01ABCDEF]\ntokens_store = "file"\n`,
      "utf8",
    );
    expect(loadConfig({ configDir: dir })).rejects.toThrow(/name/);
  });

  it("throws when [workspace.<id>] is missing required `tokens_store`", async () => {
    await writeFile(join(dir, "config.toml"), `[workspace.T01ABCDEF]\nname = "Acme"\n`, "utf8");
    expect(loadConfig({ configDir: dir })).rejects.toThrow(/tokens_store/);
  });

  it("falls back to DEFAULTS.output when [output] is missing", async () => {
    await writeFile(
      join(dir, "config.toml"),
      `[workspace.T01ABCDEF]\nname = "Acme"\ntokens_store = "file"\n`,
      "utf8",
    );
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.output).toEqual(DEFAULTS.output);
  });

  it("treats a missing [workspace] table as an empty map", async () => {
    await writeFile(
      join(dir, "config.toml"),
      `default_workspace = "T01ABCDEF"\n[output]\nformat = "human"\ncache_window_days = 14\n`,
      "utf8",
    );
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces).toEqual({});
    expect(cfg.default_workspace).toBe("T01ABCDEF");
  });

  it("ignores unknown top-level fields and unknown workspace fields", async () => {
    await writeFile(
      join(dir, "config.toml"),
      [
        `future_top_level = "ok"`,
        `[workspace.T01ABCDEF]`,
        `name = "Acme"`,
        `tokens_store = "file"`,
        `future_field = "ignored"`,
        `[output]`,
        `format = "jsonl"`,
        `cache_window_days = 7`,
        `future_output = "ok"`,
        ``,
      ].join("\n"),
      "utf8",
    );
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF).toEqual({
      name: "Acme",
      default_channel: null,
      tokens_store: "file",
    });
  });

  it("returns a deeply-frozen snapshot", async () => {
    await copyFile(join(FIXTURE_DIR, "valid.toml"), join(dir, "config.toml"));
    const cfg = await loadConfig({ configDir: dir });
    expect(Object.isFrozen(cfg)).toBe(true);
    expect(Object.isFrozen(cfg.output)).toBe(true);
    expect(Object.isFrozen(cfg.workspaces)).toBe(true);
    expect(Object.isFrozen(cfg.workspaces.T01ABCDEF)).toBe(true);
    expect(() => {
      (cfg as unknown as { default_workspace: string }).default_workspace = "T_OTHER";
    }).toThrow();
  });
});

describe("saveConfig", () => {
  const sample: Config = {
    default_workspace: "T01ABCDEF",
    workspaces: {
      T01ABCDEF: { name: "Acme", default_channel: "C0123456", tokens_store: "keychain" },
      T02XYZ: { name: "Personal", default_channel: null, tokens_store: "file" },
    },
    output: { format: "jsonl", cache_window_days: 7 },
  };

  it("creates the parent directory with mode 0o700 when missing", async () => {
    const nested = join(dir, "child");
    await saveConfig(sample, { configDir: nested });
    const s = await lstat(nested);
    expect(s.isDirectory()).toBe(true);
    expect(s.mode & 0o777).toBe(0o700);
  });

  it("writes the file with mode 0o600", async () => {
    await saveConfig(sample, { configDir: dir });
    const s = await lstat(join(dir, "config.toml"));
    expect(s.mode & 0o777).toBe(0o600);
  });

  it("does not leave .tmp residue behind", async () => {
    await saveConfig(sample, { configDir: dir });
    const entries = await readdir(dir);
    expect(entries.filter((e) => e.endsWith(".tmp"))).toEqual([]);
  });

  it("performs a tmpdir round-trip (saveConfig → loadConfig deep-equals)", async () => {
    await saveConfig(sample, { configDir: dir });
    const loaded = await loadConfig({ configDir: dir });
    expect(loaded).toEqual(sample);
  });

  it("refuses to write a config that fails the schema", async () => {
    const bad = {
      default_workspace: null,
      workspaces: {},
      output: { format: "yaml", cache_window_days: 7 },
    } as unknown as Config;
    await expect(saveConfig(bad, { configDir: dir })).rejects.toThrow(/format/);
    const entries = await readdir(dir).catch(() => []);
    expect(entries).toEqual([]);
  });

  it("does not modify mode on an existing parent dir", async () => {
    const { chmod } = await import("node:fs/promises");
    // Pre-create the dir with non-default mode.
    await chmod(dir, 0o755);
    await saveConfig(sample, { configDir: dir });
    const s = await lstat(dir);
    // mkdir(..., { recursive: true }) is a no-op on an existing dir, so the
    // 0o755 we set must survive.
    expect(s.mode & 0o777).toBe(0o755);
  });
});

describe("io round-trip stability (smol-toml regression guard)", () => {
  it("toml-string → load → save → toml-string is stable", async () => {
    const path = join(dir, "config.toml");
    const original = [
      `default_workspace = "T01ABCDEF"`,
      ``,
      `[workspace.T01ABCDEF]`,
      `name = "Acme"`,
      `default_channel = "C0123456"`,
      `tokens_store = "keychain"`,
      ``,
      `[output]`,
      `format = "jsonl"`,
      `cache_window_days = 7`,
      ``,
    ].join("\n");
    await writeFile(path, original, "utf8");

    const loadedOnce = await loadConfig({ configDir: dir });
    await saveConfig(loadedOnce, { configDir: dir });
    const firstWrite = await readFile(path, "utf8");

    const loadedTwice = await loadConfig({ configDir: dir });
    await saveConfig(loadedTwice, { configDir: dir });
    const secondWrite = await readFile(path, "utf8");

    expect(secondWrite).toBe(firstWrite);
    // cache_window_days must be an integer literal (not 7.0). smol-toml emits
    // integers for integer JS numbers; this asserts it has not regressed.
    expect(firstWrite).toContain("cache_window_days = 7\n");
    expect(firstWrite).not.toContain("cache_window_days = 7.0");
  });
});
