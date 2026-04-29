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
    await expect(store.set("ws-1", "xoxc-stolen-token")).rejects.toThrow(/Slack AUP/);
  });

  it("round-trips an xoxp- token through set / get / remove", async () => {
    const store = new MemoryTokenStore();
    await store.set("ws-1", "xoxp-test-token");
    expect(await store.get("ws-1")).toBe("xoxp-test-token");
    await store.remove("ws-1");
    expect(await store.get("ws-1")).toBeUndefined();
  });
});
