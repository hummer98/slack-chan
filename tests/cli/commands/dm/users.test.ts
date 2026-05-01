import { describe, expect, it } from "bun:test";
import { ErrorCode } from "@slack/web-api";
import { resolveUserId } from "../../../../src/cli/commands/dm/users.ts";
import { TransientError, UserError } from "../../../../src/cli/errors.ts";
import { SlackClient } from "../../../../src/slack/client.ts";

const BOT_TOKEN = "xoxb-test-1234567890abcd";
const USER_TOKEN = "xoxp-test-1234567890abcd";

interface UsersListPage {
  members: Array<{
    id?: string;
    name?: string;
    deleted?: boolean;
    profile?: { display_name?: string; display_name_normalized?: string };
  }>;
  next_cursor?: string;
}

interface MakeClientOpts {
  lookupByEmail?: (args: Record<string, unknown>) => Promise<unknown>;
  usersListPages?: UsersListPage[];
  usersListThrow?: unknown;
}

function makeClient(opts: MakeClientOpts = {}): SlackClient {
  const client = new SlackClient({ team_id: "T01ABCDEF", token: BOT_TOKEN });
  if (opts.lookupByEmail !== undefined) {
    Object.defineProperty(client, "usersLookupByEmail", {
      value: opts.lookupByEmail,
    });
  }
  if (opts.usersListPages !== undefined || opts.usersListThrow !== undefined) {
    let i = 0;
    Object.defineProperty(client, "usersList", {
      value: async () => {
        if (opts.usersListThrow !== undefined) throw opts.usersListThrow;
        const page = opts.usersListPages?.[i++];
        if (page === undefined) {
          return { ok: true, members: [], response_metadata: {} };
        }
        return {
          ok: true,
          members: page.members,
          response_metadata: { next_cursor: page.next_cursor ?? "" },
        };
      },
    });
  }
  return client;
}

describe("resolveUserId", () => {
  it("(1) Uxxx は API 呼ばずに即返し", async () => {
    let called = false;
    const client = makeClient({
      lookupByEmail: async () => {
        called = true;
        return {};
      },
    });
    const id = await resolveUserId({
      user: "U0123ABCDEF",
      userKind: "id",
      token: BOT_TOKEN,
      client,
    });
    expect(id).toBe("U0123ABCDEF");
    expect(called).toBe(false);
  });

  it("(2) email → users.lookupByEmail で id 取得", async () => {
    let captured: Record<string, unknown> | undefined;
    const client = makeClient({
      lookupByEmail: async (args) => {
        captured = args;
        return { ok: true, user: { id: "U0987XYZ" } };
      },
    });
    const id = await resolveUserId({
      user: "alice@example.com",
      userKind: "email",
      token: BOT_TOKEN,
      client,
    });
    expect(id).toBe("U0987XYZ");
    expect(captured?.email).toBe("alice@example.com");
  });

  it("(3) email + users_not_found → UserError", async () => {
    const client = makeClient({
      lookupByEmail: async () => ({ ok: false, error: "users_not_found" }),
    });
    await expect(
      resolveUserId({
        user: "ghost@example.com",
        userKind: "email",
        token: BOT_TOKEN,
        client,
      }),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("(4) email + missing_scope (PlatformError) + bot token → UserError + ヒント", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "missing_scope" },
    });
    const client = makeClient({
      lookupByEmail: async () => {
        throw platformErr;
      },
    });
    try {
      await resolveUserId({
        user: "alice@example.com",
        userKind: "email",
        token: BOT_TOKEN,
        client,
      });
      throw new Error("expected UserError");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg).toContain("users:read.email");
      expect(msg).toContain("Bot Token Scopes");
    }
  });

  it("(5) email + missing_scope + user token → スコープ警告のみ", async () => {
    const platformErr = Object.assign(new Error("platform error"), {
      code: ErrorCode.PlatformError,
      data: { error: "missing_scope" },
    });
    const client = makeClient({
      lookupByEmail: async () => {
        throw platformErr;
      },
    });
    try {
      await resolveUserId({
        user: "alice@example.com",
        userKind: "email",
        token: USER_TOKEN,
        client,
      });
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg).toContain("users:read.email");
      expect(msg).not.toContain("Bot Token Scopes");
    }
  });

  it("(6) email + ratelimited (RateLimitedError) → TransientError", async () => {
    const rateErr = Object.assign(new Error("rate limited"), {
      code: ErrorCode.RateLimitedError,
      retryAfter: 30,
    });
    const client = makeClient({
      lookupByEmail: async () => {
        throw rateErr;
      },
    });
    await expect(
      resolveUserId({
        user: "alice@example.com",
        userKind: "email",
        token: BOT_TOKEN,
        client,
      }),
    ).rejects.toBeInstanceOf(TransientError);
  });

  it("(7) @name → 1 ページ走査して hit", async () => {
    const client = makeClient({
      usersListPages: [
        {
          members: [
            { id: "U1", name: "bob" },
            { id: "U2", name: "alice", profile: { display_name: "Alice" } },
          ],
        },
      ],
    });
    const id = await resolveUserId({
      user: "@alice",
      userKind: "name",
      token: BOT_TOKEN,
      client,
    });
    expect(id).toBe("U2");
  });

  it("(8) @name → 複数ページ paginate", async () => {
    const client = makeClient({
      usersListPages: [
        { members: [{ id: "U1", name: "bob" }], next_cursor: "p2" },
        { members: [{ id: "U2", name: "alice" }] },
      ],
    });
    const id = await resolveUserId({
      user: "@alice",
      userKind: "name",
      token: BOT_TOKEN,
      client,
    });
    expect(id).toBe("U2");
  });

  it("(9) @name display_name (case insensitive) で hit", async () => {
    const client = makeClient({
      usersListPages: [
        {
          members: [
            { id: "U1", name: "carol", profile: { display_name: "Carol Long" } },
            {
              id: "U2",
              name: "u2",
              profile: { display_name_normalized: "Charlie" },
            },
          ],
        },
      ],
    });
    const id = await resolveUserId({
      user: "@charlie",
      userKind: "name",
      token: BOT_TOKEN,
      client,
    });
    expect(id).toBe("U2");
  });

  it("(10) @name 0 件 → UserError", async () => {
    const client = makeClient({
      usersListPages: [{ members: [{ id: "U1", name: "bob" }] }],
    });
    await expect(
      resolveUserId({
        user: "@nobody",
        userKind: "name",
        token: BOT_TOKEN,
        client,
      }),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("(11) @name 2 件以上 → ambiguous UserError", async () => {
    const client = makeClient({
      usersListPages: [
        {
          members: [
            { id: "U1", name: "alice" },
            { id: "U2", name: "x", profile: { display_name: "alice" } },
          ],
        },
      ],
    });
    try {
      await resolveUserId({
        user: "@alice",
        userKind: "name",
        token: BOT_TOKEN,
        client,
      });
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg).toContain("ambiguous");
      expect(msg).toContain("U1");
      expect(msg).toContain("U2");
    }
  });

  it("(12) @name + users.list missing_scope → UserError", async () => {
    const client = new SlackClient({ team_id: "T01ABCDEF", token: BOT_TOKEN });
    Object.defineProperty(client, "usersList", {
      value: async () => ({ ok: false, error: "missing_scope" }),
    });
    try {
      await resolveUserId({
        user: "@alice",
        userKind: "name",
        token: BOT_TOKEN,
        client,
      });
      throw new Error();
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("users:read");
    }
  });

  it("(13) @name 削除済ユーザは除外", async () => {
    const client = makeClient({
      usersListPages: [
        {
          members: [
            { id: "U1", name: "alice", deleted: true },
            { id: "U2", name: "alice" },
          ],
        },
      ],
    });
    const id = await resolveUserId({
      user: "@alice",
      userKind: "name",
      token: BOT_TOKEN,
      client,
    });
    expect(id).toBe("U2");
  });
});
