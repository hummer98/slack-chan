import { afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import { execFile as execFileCb } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { KeychainTokenStore, whichSecuritySync } from "../../src/secrets/keychain-store.ts";

const execFile = promisify(execFileCb);

/**
 * The Keychain backend tests are macOS-only, gated by:
 *  - platform === darwin
 *  - `security` is on PATH
 *  - NOT running in CI (M4: CI macos-latest can hang on a locked default
 *    keychain — we run these locally only)
 *
 * Service names are prefixed `slack-chan-test-` so a crashed test cannot
 * stomp on a user's real Slack token; a beforeAll sweep also clears any
 * residue from prior crashed runs.
 */
const SHOULD_SKIP =
  process.platform !== "darwin" || !whichSecuritySync() || process.env.CI === "true";

const TEST_SERVICE_PREFIX = "slack-chan-test-";

async function deleteAllTestEntries(service: string): Promise<void> {
  // Loop deleting until no more entries match. `delete-generic-password`
  // returns exit code 44 (errSecItemNotFound) when nothing matches.
  for (;;) {
    try {
      await execFile("security", ["delete-generic-password", "-s", service]);
    } catch {
      return;
    }
  }
}

describe.skipIf(SHOULD_SKIP)("KeychainTokenStore (macOS, local only)", () => {
  let dir: string;
  let service: string;

  beforeAll(async () => {
    // Sweep any leftover items from a previously crashed test run. We can
    // only do this for services we know about — best-effort.
    for (const known of [`${TEST_SERVICE_PREFIX}base`]) {
      await deleteAllTestEntries(known);
    }
  });

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "slack-chan-keychain-test-"));
    // Per-test unique service so parallel test files / leftover items
    // cannot collide.
    service = `${TEST_SERVICE_PREFIX}${process.pid}-${Date.now()}-${Math.random()
      .toString(36)
      .slice(2, 8)}`;
  });

  afterEach(async () => {
    await deleteAllTestEntries(service);
    await rm(dir, { recursive: true, force: true });
  });

  it("round-trips set / get / delete / list for an xoxp- token", async () => {
    const store = new KeychainTokenStore({ configDir: dir, service });
    await store.set("T0001", "xoxp-test-token-aaaa");
    expect(await store.get("T0001")).toBe("xoxp-test-token-aaaa");
    expect(await store.list()).toEqual(["T0001"]);
    await store.delete("T0001");
    expect(await store.get("T0001")).toBeUndefined();
    expect(await store.list()).toEqual([]);
  });

  it("get returns undefined for an unknown team_id (errSecItemNotFound = 44)", async () => {
    const store = new KeychainTokenStore({ configDir: dir, service });
    expect(await store.get("T9999")).toBeUndefined();
  });

  it("delete on an unknown team_id is a no-op (errSecItemNotFound = 44)", async () => {
    const store = new KeychainTokenStore({ configDir: dir, service });
    await store.delete("T9999"); // must not throw
  });

  it("rejects xoxc- (Slack AUP) at set()", async () => {
    const store = new KeychainTokenStore({ configDir: dir, service });
    await expect(store.set("T0001", "xoxc-stolen-token")).rejects.toThrow(/Slack AUP/);
    expect(await store.list()).toEqual([]);
  });

  it("rejects argv-injection-style team_id (M5)", async () => {
    const store = new KeychainTokenStore({ configDir: dir, service });
    await expect(store.set("-foo", "xoxp-test-aaaa")).rejects.toThrow(/team_id/);
    await expect(store.get("-foo")).rejects.toThrow(/team_id/);
    await expect(store.delete("-foo")).rejects.toThrow(/team_id/);
  });

  it("list() reflects the index file written alongside the keychain entry", async () => {
    const store = new KeychainTokenStore({ configDir: dir, service });
    await store.set("T0001", "xoxp-aaaa-aaaa");
    await store.set("T0002", "xoxp-bbbb-bbbb");
    expect((await store.list()).sort()).toEqual(["T0001", "T0002"]);
    await store.delete("T0001");
    expect((await store.list()).sort()).toEqual(["T0002"]);
  });
});

describe("whichSecuritySync — pure unit", () => {
  it("returns a boolean", () => {
    expect(typeof whichSecuritySync()).toBe("boolean");
  });
});
