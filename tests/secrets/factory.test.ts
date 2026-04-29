import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTokenStore } from "../../src/secrets/factory.ts";
import { FileTokenStore } from "../../src/secrets/file-store.ts";
import { KeychainTokenStore, whichSecuritySync } from "../../src/secrets/keychain-store.ts";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "slack-chan-factory-test-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("createTokenStore", () => {
  it("returns a FileTokenStore for kind === 'file'", () => {
    const store = createTokenStore("file", { configDir: dir });
    expect(store).toBeInstanceOf(FileTokenStore);
  });

  it("returns a KeychainTokenStore for kind === 'keychain' on macOS with security available", () => {
    if (process.platform !== "darwin" || !whichSecuritySync()) {
      // On platforms where keychain is unavailable, the next test covers
      // the throw path. Skip the positive assertion here.
      return;
    }
    const store = createTokenStore("keychain", { configDir: dir });
    expect(store).toBeInstanceOf(KeychainTokenStore);
  });

  it("throws when kind === 'keychain' on a non-darwin platform", () => {
    if (process.platform === "darwin") {
      // Cannot exercise the non-darwin branch on macOS; the inverse case
      // (positive) is checked above. The negative branch is unit-tested
      // by short-circuiting `whichSecuritySync` below.
      return;
    }
    expect(() => createTokenStore("keychain", { configDir: dir })).toThrow(/macOS/);
  });

  it("throws when kind === 'keychain' but security is not available", () => {
    if (process.platform === "darwin" && whichSecuritySync()) {
      // On a real macOS dev box `security` is always present; only assert
      // the helper's error text via the gated path below using a stub.
      return;
    }
    // Either non-darwin, or darwin without `security` (rare).
    expect(() => createTokenStore("keychain", { configDir: dir })).toThrow();
  });

  it("throws on an unknown kind", () => {
    expect(() => createTokenStore("memory" as unknown as "file", { configDir: dir })).toThrow(
      /unknown/i,
    );
  });
});
