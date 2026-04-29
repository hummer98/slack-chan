import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getDefaultChannel,
  getDefaultWorkspace,
  getOutputFormat,
  removeWorkspace,
  setWorkspace,
} from "../../src/config/api.ts";
import { loadConfig, saveConfig } from "../../src/config/io.ts";
import type { Config } from "../../src/config/types.ts";

let dir: string;

const baseConfig: Config = {
  default_workspace: "T01ABCDEF",
  workspaces: {
    T01ABCDEF: { name: "Acme", default_channel: "C0123456", tokens_store: "keychain" },
    T02XYZ: { name: "Personal", default_channel: null, tokens_store: "file" },
  },
  output: { format: "jsonl", cache_window_days: 7 },
};

const ctrl = (code: number) => String.fromCharCode(code);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slack-chan-api-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("getDefaultWorkspace (env > config)", () => {
  it("returns the env value when set", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const result = await getDefaultWorkspace({
      configDir: dir,
      env: { SLACK_CHAN_DEFAULT_WORKSPACE: "T99OVERRIDE" },
    });
    expect(result).toBe("T99OVERRIDE");
  });

  it("ignores an empty / whitespace-only env value", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(
      await getDefaultWorkspace({ configDir: dir, env: { SLACK_CHAN_DEFAULT_WORKSPACE: "" } }),
    ).toBe("T01ABCDEF");
    expect(
      await getDefaultWorkspace({
        configDir: dir,
        env: { SLACK_CHAN_DEFAULT_WORKSPACE: "   " },
      }),
    ).toBe("T01ABCDEF");
  });

  it("throws when the env value violates team_id format", async () => {
    expect(
      getDefaultWorkspace({
        configDir: dir,
        env: { SLACK_CHAN_DEFAULT_WORKSPACE: "lowercase" },
      }),
    ).rejects.toThrow(/T\[A-Z0-9\]/);
  });

  it("returns config.default_workspace when env is unset", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(await getDefaultWorkspace({ configDir: dir, env: {} })).toBe("T01ABCDEF");
  });

  it("returns null when neither env nor config is set", async () => {
    expect(await getDefaultWorkspace({ configDir: dir, env: {} })).toBeNull();
  });
});

describe("getDefaultChannel (env > config)", () => {
  it("returns the env value when set, regardless of workspace", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const result = await getDefaultChannel("T01ABCDEF", {
      configDir: dir,
      env: { SLACK_CHAN_DEFAULT_CHANNEL: "#override" },
    });
    expect(result).toBe("#override");
  });

  it("returns the env value even for an unknown workspace", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    const result = await getDefaultChannel("T99NOTHERE", {
      configDir: dir,
      env: { SLACK_CHAN_DEFAULT_CHANNEL: "Cffff" },
    });
    expect(result).toBe("Cffff");
  });

  it("throws when env value contains control characters that survive trim()", async () => {
    // BEL (0x07) is not whitespace, so it stays after trim().
    expect(
      getDefaultChannel("T01ABCDEF", {
        configDir: dir,
        env: { SLACK_CHAN_DEFAULT_CHANNEL: `chan${ctrl(0x07)}nel` },
      }),
    ).rejects.toThrow(/control/i);
    // NUL (0x00) likewise.
    expect(
      getDefaultChannel("T01ABCDEF", {
        configDir: dir,
        env: { SLACK_CHAN_DEFAULT_CHANNEL: `chan${ctrl(0x00)}nel` },
      }),
    ).rejects.toThrow(/control/i);
    // DEL (0x7F).
    expect(
      getDefaultChannel("T01ABCDEF", {
        configDir: dir,
        env: { SLACK_CHAN_DEFAULT_CHANNEL: `chan${ctrl(0x7f)}nel` },
      }),
    ).rejects.toThrow(/control/i);
  });

  it("returns the workspace channel from config when env is unset", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(await getDefaultChannel("T01ABCDEF", { configDir: dir, env: {} })).toBe("C0123456");
  });

  it("returns null when the workspace has no default_channel", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(await getDefaultChannel("T02XYZ", { configDir: dir, env: {} })).toBeNull();
  });

  it("returns null for an unknown workspace when env is unset", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(await getDefaultChannel("T99NOTHERE", { configDir: dir, env: {} })).toBeNull();
  });

  it("rejects an invalid team_id parameter", async () => {
    expect(getDefaultChannel("not-a-team-id", { configDir: dir, env: {} })).rejects.toThrow();
  });
});

describe("getOutputFormat (env > config)", () => {
  it("returns the env value when set", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(
      await getOutputFormat({ configDir: dir, env: { SLACK_CHAN_OUTPUT_FORMAT: "human" } }),
    ).toBe("human");
  });

  it("throws when env value is outside OUTPUT_FORMATS", async () => {
    expect(
      getOutputFormat({ configDir: dir, env: { SLACK_CHAN_OUTPUT_FORMAT: "yaml" } }),
    ).rejects.toThrow(/jsonl/);
  });

  it("returns config value when env is unset", async () => {
    await saveConfig(
      { ...baseConfig, output: { format: "toon", cache_window_days: 7 } },
      {
        configDir: dir,
      },
    );
    expect(await getOutputFormat({ configDir: dir, env: {} })).toBe("toon");
  });

  it("returns the default 'jsonl' when neither env nor config is set", async () => {
    expect(await getOutputFormat({ configDir: dir, env: {} })).toBe("jsonl");
  });
});

describe("setWorkspace", () => {
  it("creates a new workspace from a complete patch", async () => {
    await setWorkspace(
      "T03NEW",
      { name: "Brand New", default_channel: "Cabc", tokens_store: "file" },
      { configDir: dir },
    );
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T03NEW).toEqual({
      name: "Brand New",
      default_channel: "Cabc",
      tokens_store: "file",
    });
  });

  it("requires `name` and `tokens_store` for a new workspace", async () => {
    expect(setWorkspace("T03NEW", { tokens_store: "file" }, { configDir: dir })).rejects.toThrow(
      /name/,
    );
    expect(setWorkspace("T03NEW", { name: "Solo" }, { configDir: dir })).rejects.toThrow(
      /tokens_store/,
    );
  });

  it("partial-updates an existing workspace, preserving other fields", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await setWorkspace("T01ABCDEF", { default_channel: "Cnewest" }, { configDir: dir });
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF).toEqual({
      name: "Acme",
      default_channel: "Cnewest",
      tokens_store: "keychain",
    });
  });

  it("can clear default_channel by passing null", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await setWorkspace("T01ABCDEF", { default_channel: null }, { configDir: dir });
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.workspaces.T01ABCDEF?.default_channel).toBeNull();
  });

  it("rejects an invalid team_id", async () => {
    expect(
      setWorkspace("not-a-team-id", { name: "x", tokens_store: "file" }, { configDir: dir }),
    ).rejects.toThrow();
  });

  it("rejects an invalid patch field", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    expect(
      setWorkspace("T01ABCDEF", { tokens_store: "memory" } as unknown as { tokens_store: "file" }, {
        configDir: dir,
      }),
    ).rejects.toThrow();
  });

  it("does NOT write env-overridden values back to disk", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    // env override is set, but setWorkspace must operate on saved file only.
    await setWorkspace(
      "T01ABCDEF",
      { default_channel: "Csaved" },
      {
        configDir: dir,
        env: {
          SLACK_CHAN_DEFAULT_WORKSPACE: "T99FROMENV",
          SLACK_CHAN_DEFAULT_CHANNEL: "#fromenv",
          SLACK_CHAN_OUTPUT_FORMAT: "human",
        },
      },
    );
    const raw = await readFile(join(dir, "config.toml"), "utf8");
    expect(raw).not.toContain("T99FROMENV");
    expect(raw).not.toContain("fromenv");
    expect(raw).not.toContain("human");
    // The patch we passed must, however, land on disk.
    expect(raw).toContain("Csaved");
    // And the original (non-env) saved values must be preserved.
    expect(raw).toContain("T01ABCDEF");
  });
});

describe("removeWorkspace", () => {
  it("removes the entry", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await removeWorkspace("T02XYZ", { configDir: dir });
    const cfg = await loadConfig({ configDir: dir });
    expect("T02XYZ" in cfg.workspaces).toBe(false);
    expect("T01ABCDEF" in cfg.workspaces).toBe(true);
  });

  it("clears default_workspace when it pointed at the removed entry", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await removeWorkspace("T01ABCDEF", { configDir: dir });
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg.default_workspace).toBeNull();
  });

  it("is a no-op when the workspace is absent", async () => {
    await saveConfig(baseConfig, { configDir: dir });
    await removeWorkspace("T99NOTHERE", { configDir: dir });
    const cfg = await loadConfig({ configDir: dir });
    expect(cfg).toEqual(baseConfig);
  });

  it("rejects an invalid team_id", async () => {
    expect(removeWorkspace("not-a-team-id", { configDir: dir })).rejects.toThrow();
  });
});
