import { describe, expect, it } from "bun:test";
import { assertAllowedSlackToken, MemoryTokenStore } from "../../src/secrets/index.ts";

describe("assertAllowedSlackToken", () => {
  it("accepts xoxp- (User OAuth) tokens", () => {
    expect(() => assertAllowedSlackToken("xoxp-1234567890-1234567890-abcdef")).not.toThrow();
  });

  it("accepts xoxb- (Bot) tokens", () => {
    expect(() => assertAllowedSlackToken("xoxb-1234567890-abcdefghijklm")).not.toThrow();
  });

  it("rejects xoxc- (browser session) tokens with Slack AUP wording", () => {
    expect(() => assertAllowedSlackToken("xoxc-stolen-token")).toThrow(/Slack AUP/);
  });

  it("rejects xoxd- (browser session) tokens with Slack AUP wording", () => {
    expect(() => assertAllowedSlackToken("xoxd-stolen-token")).toThrow(/Slack AUP/);
  });

  it("rejects empty string", () => {
    expect(() => assertAllowedSlackToken("")).toThrow();
  });

  it("rejects non-string input", () => {
    expect(() => assertAllowedSlackToken(undefined)).toThrow();
    expect(() => assertAllowedSlackToken(123)).toThrow();
  });
});

describe("MemoryTokenStore (guard wiring smoke check)", () => {
  it("rejects xoxc- via set() — confirms the guard is wired through the store", async () => {
    const store = new MemoryTokenStore();
    await expect(store.set("T0001", "xoxc-stolen-token")).rejects.toThrow(/Slack AUP/);
  });

  it("round-trips an xoxp- token through set / get / delete", async () => {
    const store = new MemoryTokenStore();
    await store.set("T0001", "xoxp-test-token");
    expect(await store.get("T0001")).toBe("xoxp-test-token");
    await store.delete("T0001");
    expect(await store.get("T0001")).toBeUndefined();
  });

  it("list() returns the team_ids that have been set", async () => {
    const store = new MemoryTokenStore();
    await store.set("T0001", "xoxp-a");
    await store.set("T0002", "xoxp-b");
    const ids = await store.list();
    expect(ids.sort()).toEqual(["T0001", "T0002"]);
    await store.delete("T0001");
    expect(await store.list()).toEqual(["T0002"]);
  });
});
