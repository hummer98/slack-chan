import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";
import { resolveConfigDir, resolveConfigPath } from "../../src/config/path.ts";

describe("resolveConfigDir", () => {
  it("returns <XDG_CONFIG_HOME>/slack-chan when XDG is set", () => {
    const dir = resolveConfigDir({ env: { XDG_CONFIG_HOME: "/tmp/x" } });
    expect(dir).toBe(join("/tmp/x", "slack-chan"));
  });

  it("falls back to $HOME/.config/slack-chan when XDG is unset", () => {
    const dir = resolveConfigDir({ env: {} });
    expect(dir).toBe(join(homedir(), ".config", "slack-chan"));
  });

  it("treats an empty string as unset", () => {
    const dir = resolveConfigDir({ env: { XDG_CONFIG_HOME: "" } });
    expect(dir).toBe(join(homedir(), ".config", "slack-chan"));
  });

  it("treats a whitespace-only string as unset", () => {
    const dir = resolveConfigDir({ env: { XDG_CONFIG_HOME: "   " } });
    expect(dir).toBe(join(homedir(), ".config", "slack-chan"));
  });

  it("prefers explicit configDir over env", () => {
    const dir = resolveConfigDir({
      configDir: "/explicit/path",
      env: { XDG_CONFIG_HOME: "/tmp/x" },
    });
    expect(dir).toBe("/explicit/path");
  });

  it("treats an empty / whitespace explicit configDir as unset", () => {
    expect(resolveConfigDir({ configDir: "", env: { XDG_CONFIG_HOME: "/tmp/x" } })).toBe(
      join("/tmp/x", "slack-chan"),
    );
    expect(resolveConfigDir({ configDir: "  ", env: { XDG_CONFIG_HOME: "/tmp/x" } })).toBe(
      join("/tmp/x", "slack-chan"),
    );
  });

  it("falls back to process.env when no env is provided", () => {
    const prev = process.env.XDG_CONFIG_HOME;
    process.env.XDG_CONFIG_HOME = "/tmp/proc";
    try {
      expect(resolveConfigDir()).toBe(join("/tmp/proc", "slack-chan"));
    } finally {
      if (prev === undefined) delete process.env.XDG_CONFIG_HOME;
      else process.env.XDG_CONFIG_HOME = prev;
    }
  });
});

describe("resolveConfigPath", () => {
  it("returns <configDir>/config.toml", () => {
    const path = resolveConfigPath({ env: { XDG_CONFIG_HOME: "/tmp/x" } });
    expect(path).toBe(join("/tmp/x", "slack-chan", "config.toml"));
  });

  it("respects explicit configDir", () => {
    const path = resolveConfigPath({ configDir: "/explicit" });
    expect(path).toBe(join("/explicit", "config.toml"));
  });
});
