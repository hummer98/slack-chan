import { describe, expect, it } from "bun:test";
import { redactFixture } from "../../src/testing/fixture-redact.ts";
import type { SlackFixtureRaw } from "../../src/testing/fixture-types.ts";

function makeRaw(
  data: Record<string, unknown>,
  params: Record<string, unknown> | null = null,
): SlackFixtureRaw {
  return {
    method: "test.method",
    params,
    status: 200,
    data,
    recorded_at: "2026-04-29T00:00:00.000Z",
    redacted: false,
  };
}

describe("redactFixture", () => {
  it("flips redacted false → true", () => {
    const out = redactFixture(makeRaw({ ok: true }));
    expect(out.redacted).toBe(true);
  });

  it("replaces Slack bot tokens with the fixed test token", () => {
    const raw = makeRaw({ token: "xoxb-1111-2222-deadbeef" });
    const out = redactFixture(raw);
    expect(out.data.token).toBe("xoxb-test-token");
  });

  it("replaces Slack user / app tokens (xoxp, xoxa, xoxr, xoxs, xapp)", () => {
    const raw = makeRaw({
      a: "xoxp-AAA-BBB",
      b: "xoxa-CCC-DDD",
      c: "xoxr-EEE-FFF",
      d: "xoxs-GGG-HHH",
      e: "xapp-1-A123-456-tail",
    });
    const out = redactFixture(raw);
    expect(out.data.a).toBe("xoxb-test-token");
    expect(out.data.b).toBe("xoxb-test-token");
    expect(out.data.c).toBe("xoxb-test-token");
    expect(out.data.d).toBe("xoxb-test-token");
    expect(out.data.e).toBe("xoxb-test-token");
  });

  it("maps the same User ID consistently within one call", () => {
    const raw = makeRaw({ a: "U123ABC456", b: "U123ABC456", c: "U999XYZ000" });
    const out = redactFixture(raw);
    expect(out.data.a).toBe("U_TEST_001");
    expect(out.data.b).toBe("U_TEST_001");
    expect(out.data.c).toBe("U_TEST_002");
  });

  it("maps Team / Channel / DM / Group / Enterprise / File IDs each in their own counter", () => {
    const raw = makeRaw({
      team: "T01ABCDEF",
      channel: "C01ABCDEF",
      dm: "D01ABCDEF",
      group: "G01ABCDEF",
      enterprise: "E01ABCDEF",
      file: "F01ABCDEF",
    });
    const out = redactFixture(raw);
    expect(out.data.team).toBe("T_TEST_001");
    expect(out.data.channel).toBe("C_TEST_001");
    expect(out.data.dm).toBe("D_TEST_001");
    expect(out.data.group).toBe("G_TEST_001");
    expect(out.data.enterprise).toBe("E_TEST_001");
    expect(out.data.file).toBe("F_TEST_001");
  });

  it("starts a fresh counter on each call (no global state leak)", () => {
    redactFixture(makeRaw({ u: "U999XYZ000" }));
    const out = redactFixture(makeRaw({ u: "U123ABC456" }));
    expect(out.data.u).toBe("U_TEST_001");
  });

  it("replaces emails and aligns real_name to the same N", () => {
    const raw = makeRaw({
      profile: { email: "alice@example.com", real_name: "Alice Tan" },
      another: { email: "bob@example.com", real_name: "Bob Lee" },
    });
    const out = redactFixture(raw);
    const profile = out.data.profile as Record<string, unknown>;
    const another = out.data.another as Record<string, unknown>;
    expect(profile.email).toBe("user-1@example.test");
    expect(profile.real_name).toBe("User 1");
    expect(another.email).toBe("user-2@example.test");
    expect(another.real_name).toBe("User 2");
  });

  it("replaces text-keyed fields with redacted-message-N regardless of value", () => {
    const raw = makeRaw({
      message: { text: "hello world" },
      blocks: [{ text: { text: "block content" } }],
    });
    const out = redactFixture(raw);
    const message = out.data.message as Record<string, unknown>;
    const blocks = out.data.blocks as Array<{ text: { text: string } }>;
    expect(message.text).toBe("redacted-message-1");
    expect(blocks[0]?.text.text).toBe("redacted-message-2");
  });

  it("walks nested objects and arrays", () => {
    const raw = makeRaw({
      members: [
        { id: "U123ABC456", profile: { display_name: "Alice" } },
        { id: "U999XYZ000", profile: { display_name: "Bob" } },
      ],
    });
    const out = redactFixture(raw);
    const members = out.data.members as Array<{ id: string; profile: { display_name: string } }>;
    expect(members[0]?.id).toBe("U_TEST_001");
    expect(members[0]?.profile.display_name).toBe("User 1");
    expect(members[1]?.id).toBe("U_TEST_002");
    expect(members[1]?.profile.display_name).toBe("User 2");
  });

  it("redacts ID strings embedded inside larger text values", () => {
    const raw = makeRaw({
      log_line: "user U123ABC456 joined channel C01ABCDEF",
    });
    const out = redactFixture(raw);
    expect(out.data.log_line).toBe("user U_TEST_001 joined channel C_TEST_001");
  });

  it("preserves top-level fixture metadata (method / params / status / recorded_at)", () => {
    const raw: SlackFixtureRaw = {
      method: "auth.test",
      params: { foo: "bar" },
      status: 200,
      data: { ok: true },
      recorded_at: "2026-04-29T00:00:00.000Z",
      redacted: false,
    };
    const out = redactFixture(raw);
    expect(out.method).toBe("auth.test");
    expect(out.params).toEqual({ foo: "bar" });
    expect(out.status).toBe(200);
    expect(out.recorded_at).toBe("2026-04-29T00:00:00.000Z");
  });
});
