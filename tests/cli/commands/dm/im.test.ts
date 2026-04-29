import { describe, expect, it } from "bun:test";
import { ErrorCode } from "@slack/web-api";
import { openImChannel } from "../../../../src/cli/commands/dm/im.ts";
import { InternalError, TransientError, UserError } from "../../../../src/cli/errors.ts";
import { SlackClient } from "../../../../src/slack/client.ts";

function makeClient(impl: (args: unknown) => Promise<unknown> | never): SlackClient {
  const client = new SlackClient({ team_id: "T01ABCDEF", token: "xoxb-test-1" });
  Object.defineProperty(client, "conversationsOpen", { value: impl });
  return client;
}

describe("openImChannel", () => {
  it("(1) success → Dxxx 抽出", async () => {
    let captured: Record<string, unknown> | undefined;
    const client = makeClient(async (args) => {
      captured = args as Record<string, unknown>;
      return { ok: true, channel: { id: "D0123ABCDEF" } };
    });
    const id = await openImChannel({ user_id: "U0123ABCDEF", client });
    expect(id).toBe("D0123ABCDEF");
    expect(captured?.users).toBe("U0123ABCDEF");
    expect(captured?.return_im).toBe(true);
  });

  it("(2) ok=false user_not_found → UserError", async () => {
    const client = makeClient(async () => ({ ok: false, error: "user_not_found" }));
    await expect(openImChannel({ user_id: "U0123ABCDEF", client })).rejects.toBeInstanceOf(
      UserError,
    );
  });

  it("(3) cannot_dm_bot → UserError", async () => {
    const client = makeClient(async () => ({ ok: false, error: "cannot_dm_bot" }));
    try {
      await openImChannel({ user_id: "U0123ABCDEF", client });
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("cannot_dm_bot");
    }
  });

  it("(4) missing_scope → UserError + ヒント", async () => {
    const client = makeClient(async () => ({ ok: false, error: "missing_scope" }));
    try {
      await openImChannel({ user_id: "U0123ABCDEF", client });
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("im:write");
    }
  });

  it("(5) PlatformError missing_scope → UserError + ヒント", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "missing_scope" },
    });
    const client = makeClient(async () => {
      throw platformErr;
    });
    try {
      await openImChannel({ user_id: "U0123ABCDEF", client });
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("im:write");
    }
  });

  it("(6) PlatformError cannot_dm_bot → UserError", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "cannot_dm_bot" },
    });
    const client = makeClient(async () => {
      throw platformErr;
    });
    await expect(openImChannel({ user_id: "U0123ABCDEF", client })).rejects.toBeInstanceOf(
      UserError,
    );
  });

  it("(7) RateLimitedError → TransientError", async () => {
    const rateErr = Object.assign(new Error("rate limited"), {
      code: ErrorCode.RateLimitedError,
      retryAfter: 30,
    });
    const client = makeClient(async () => {
      throw rateErr;
    });
    await expect(openImChannel({ user_id: "U0123ABCDEF", client })).rejects.toBeInstanceOf(
      TransientError,
    );
  });

  it("(8) channel.id 不在 → InternalError", async () => {
    const client = makeClient(async () => ({ ok: true, channel: {} }));
    await expect(openImChannel({ user_id: "U0123ABCDEF", client })).rejects.toBeInstanceOf(
      InternalError,
    );
  });

  it("(9) channel.id が D で始まらない → InternalError", async () => {
    const client = makeClient(async () => ({ ok: true, channel: { id: "C0123ABCDEF" } }));
    await expect(openImChannel({ user_id: "U0123ABCDEF", client })).rejects.toBeInstanceOf(
      InternalError,
    );
  });
});
