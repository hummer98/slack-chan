import type { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  classifyIdentifier,
  newResolveUserSentinel,
  resolveUser,
} from "../../../../src/cli/commands/user/resolveUser.ts";
import { UserError } from "../../../../src/cli/errors.ts";
import { SlackClient } from "../../../../src/slack/client.ts";
import * as usersDao from "../../../../src/storage/dao/users.ts";
import { openDatabase } from "../../../../src/storage/db.ts";
import type { UserRow } from "../../../../src/storage/types.ts";

const TEAM = "T0TEAM";
const NOW = 1_700_000_000_000;

interface UsersInfoCall {
  args: { user: string };
}
interface UsersLookupByEmailCall {
  args: { email: string };
}
interface UsersListCall {
  args: { limit?: number; cursor?: string };
}

interface UsersInfoStub {
  mode?: "ok" | "throw";
  response?: unknown;
  error?: unknown;
}
interface UsersLookupByEmailStub {
  mode?: "ok" | "throw";
  response?: unknown;
  error?: unknown;
}
interface UsersListStub {
  pages: { members?: unknown[]; response_metadata?: { next_cursor?: string } }[];
}

interface ClientWithCalls {
  client: SlackClient;
  usersInfoCalls: UsersInfoCall[];
  usersLookupByEmailCalls: UsersLookupByEmailCall[];
  usersListCalls: UsersListCall[];
  usersUpsertCalls: number;
}

function buildClient(opts: {
  usersInfo?: UsersInfoStub;
  usersLookupByEmail?: UsersLookupByEmailStub;
  usersList?: UsersListStub;
}): ClientWithCalls {
  const client = new SlackClient({ team_id: TEAM, token: "xoxb-test-token" });
  const usersInfoCalls: UsersInfoCall[] = [];
  const usersLookupByEmailCalls: UsersLookupByEmailCall[] = [];
  const usersListCalls: UsersListCall[] = [];

  Object.defineProperty(client, "usersInfo", {
    value: async (args: { user: string }) => {
      usersInfoCalls.push({ args });
      const stub = opts.usersInfo;
      if (stub === undefined) throw new Error("usersInfo not stubbed");
      if (stub.mode === "throw") throw stub.error;
      return stub.response;
    },
  });
  Object.defineProperty(client, "usersLookupByEmail", {
    value: async (args: { email: string }) => {
      usersLookupByEmailCalls.push({ args });
      const stub = opts.usersLookupByEmail;
      if (stub === undefined) throw new Error("usersLookupByEmail not stubbed");
      if (stub.mode === "throw") throw stub.error;
      return stub.response;
    },
  });
  Object.defineProperty(client, "usersList", {
    value: async (args: { limit?: number; cursor?: string }) => {
      usersListCalls.push({ args });
      const stub = opts.usersList;
      if (stub === undefined) throw new Error("usersList not stubbed");
      const idx = usersListCalls.length - 1;
      const page = stub.pages[idx];
      if (page === undefined) {
        return { members: [], response_metadata: {} };
      }
      return page;
    },
  });

  return {
    client,
    usersInfoCalls,
    usersLookupByEmailCalls,
    usersListCalls,
    usersUpsertCalls: 0,
  };
}

function makeUser(overrides: Partial<UserRow> = {}): UserRow {
  return {
    team_id: TEAM,
    user_id: "U1",
    name: "alice",
    real_name: "Alice",
    email: "alice@example.com",
    profile_json: '{"id":"U1"}',
    fetched_at: 1_600_000_000_000,
    ...overrides,
  };
}

describe("classifyIdentifier", () => {
  it("recognizes Uxxx as id", () => {
    expect(classifyIdentifier("U01ABCDEF")).toEqual({ kind: "id", value: "U01ABCDEF" });
  });
  it("recognizes Wxxx as id (workspace bot)", () => {
    expect(classifyIdentifier("WSLACKBOT")).toEqual({ kind: "id", value: "WSLACKBOT" });
  });
  it("recognizes alice@example.com as email", () => {
    expect(classifyIdentifier("alice@example.com")).toEqual({
      kind: "email",
      value: "alice@example.com",
    });
  });
  it("recognizes @yamamoto as name (strips leading @)", () => {
    expect(classifyIdentifier("@yamamoto")).toEqual({ kind: "name", value: "yamamoto" });
  });
  it("recognizes alice as name (no @ prefix)", () => {
    expect(classifyIdentifier("alice")).toEqual({ kind: "name", value: "alice" });
  });
  it("rejects @alice@example.com (NAME_RE mismatch after strip)", () => {
    expect(() => classifyIdentifier("@alice@example.com")).toThrow(UserError);
  });
  it("rejects empty / whitespace-only", () => {
    expect(() => classifyIdentifier("")).toThrow(UserError);
    expect(() => classifyIdentifier("   ")).toThrow(UserError);
  });
  it("rejects invalid chars", () => {
    expect(() => classifyIdentifier("??invalid??")).toThrow(UserError);
  });
});

describe("resolveUser", () => {
  let db: Database;

  beforeEach(() => {
    db = openDatabase({ path: ":memory:" });
  });

  afterEach(() => {
    db.close();
  });

  it("(1) id 直接 + cache miss → usersInfo 1 回 + upsert", async () => {
    const c = buildClient({
      usersInfo: {
        mode: "ok",
        response: {
          ok: true,
          user: { id: "U1", name: "alice", real_name: "Alice", profile: { email: "a@x.com" } },
        },
      },
    });
    const sentinel = newResolveUserSentinel();
    const row = await resolveUser({
      db,
      client: c.client,
      team_id: TEAM,
      identifier: "U1",
      now: NOW,
      sentinel,
    });
    // U1 は USER_ID_RE に合致しないので name 経路に流れる…と思いきや US は U + 1文字 = OK ({1,32})
    expect(c.usersInfoCalls.length).toBe(1);
    expect(c.usersInfoCalls[0]?.args).toEqual({ user: "U1" });
    expect(row.user_id).toBe("U1");
    expect(row.email).toBe("a@x.com");
    expect(row.fetched_at).toBe(NOW);
    expect(usersDao.get(db, TEAM, "U1")).not.toBeNull();
  });

  it("(2) id 直接 + cache hit → usersInfo 0 回 + upsert 0 回 (fetched_at 不変)", async () => {
    const stale = makeUser({ user_id: "U1", fetched_at: 1 });
    usersDao.upsert(db, stale);
    const c = buildClient({});
    const sentinel = newResolveUserSentinel();
    const row = await resolveUser({
      db,
      client: c.client,
      team_id: TEAM,
      identifier: "U1",
      now: NOW,
      sentinel,
    });
    expect(c.usersInfoCalls.length).toBe(0);
    expect(row).toEqual(stale);
    expect(usersDao.get(db, TEAM, "U1")?.fetched_at).toBe(1);
  });

  it("(3) email + cache miss → usersLookupByEmail 1 回 + upsert", async () => {
    const c = buildClient({
      usersLookupByEmail: {
        mode: "ok",
        response: {
          ok: true,
          user: { id: "U2", name: "bob", profile: { email: "bob@example.com" } },
        },
      },
    });
    const sentinel = newResolveUserSentinel();
    const row = await resolveUser({
      db,
      client: c.client,
      team_id: TEAM,
      identifier: "bob@example.com",
      now: NOW,
      sentinel,
    });
    expect(c.usersLookupByEmailCalls.length).toBe(1);
    expect(c.usersLookupByEmailCalls[0]?.args).toEqual({ email: "bob@example.com" });
    expect(row.user_id).toBe("U2");
    expect(row.email).toBe("bob@example.com");
    expect(usersDao.findByEmail(db, TEAM, "bob@example.com")).not.toBeNull();
  });

  it("(4) email + cache hit → usersLookupByEmail 0 回 + upsert 0 回 (fetched_at 不変)", async () => {
    const stale = makeUser({
      user_id: "U2",
      email: "bob@example.com",
      fetched_at: 7,
    });
    usersDao.upsert(db, stale);
    const c = buildClient({});
    const sentinel = newResolveUserSentinel();
    const row = await resolveUser({
      db,
      client: c.client,
      team_id: TEAM,
      identifier: "bob@example.com",
      now: NOW,
      sentinel,
    });
    expect(c.usersLookupByEmailCalls.length).toBe(0);
    expect(row.fetched_at).toBe(7);
  });

  it("(5) @name + DB hit → usersList 0 回 + upsert 0 回 (fetched_at 不変)", async () => {
    const stale = makeUser({ user_id: "U3", name: "alice", fetched_at: 9 });
    usersDao.upsert(db, stale);
    const c = buildClient({});
    const sentinel = newResolveUserSentinel();
    const row = await resolveUser({
      db,
      client: c.client,
      team_id: TEAM,
      identifier: "@alice",
      now: NOW,
      sentinel,
    });
    expect(c.usersListCalls.length).toBe(0);
    expect(row.user_id).toBe("U3");
    expect(row.fetched_at).toBe(9);
  });

  it("(6) @name + DB miss + 全 fetch hit → usersList 2 回 + sentinel=true", async () => {
    const c = buildClient({
      usersList: {
        pages: [
          {
            members: [{ id: "Ua", name: "alice" }],
            response_metadata: { next_cursor: "next1" },
          },
          {
            members: [
              { id: "Ub", name: "bob" },
              { id: "Uc", name: "carol" },
            ],
            response_metadata: { next_cursor: "" },
          },
        ],
      },
    });
    const sentinel = newResolveUserSentinel();
    const row = await resolveUser({
      db,
      client: c.client,
      team_id: TEAM,
      identifier: "@bob",
      now: NOW,
      sentinel,
    });
    expect(c.usersListCalls.length).toBe(2);
    expect(c.usersListCalls[0]?.args).toEqual({ limit: 200 });
    expect(c.usersListCalls[1]?.args).toEqual({ limit: 200, cursor: "next1" });
    expect(sentinel.fullFetched).toBe(true);
    expect(row.user_id).toBe("Ub");
    expect(usersDao.count(db, TEAM)).toBe(3);
  });

  it("(7) @name + DB miss + 全 fetch でも miss → UserError 'not found'", async () => {
    const c = buildClient({
      usersList: {
        pages: [
          {
            members: [
              { id: "Ua", name: "alice" },
              { id: "Ub", name: "bob" },
            ],
            response_metadata: { next_cursor: "" },
          },
        ],
      },
    });
    const sentinel = newResolveUserSentinel();
    let caught: unknown;
    try {
      await resolveUser({
        db,
        client: c.client,
        team_id: TEAM,
        identifier: "@nobody",
        now: NOW,
        sentinel,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UserError);
    expect((caught as UserError).message).toContain("not found");
    expect((caught as UserError).message).toContain("scanned");
    expect(sentinel.fullFetched).toBe(true);
  });

  it("(8) @name 連続 miss (sentinel reuse) → 2 回目は API を呼ばずに即 UserError", async () => {
    const c = buildClient({
      usersList: {
        pages: [
          {
            members: [{ id: "Ua", name: "alice" }],
            response_metadata: { next_cursor: "" },
          },
        ],
      },
    });
    const sentinel = newResolveUserSentinel();
    // 1 回目
    await expect(
      resolveUser({
        db,
        client: c.client,
        team_id: TEAM,
        identifier: "@x",
        now: NOW,
        sentinel,
      }),
    ).rejects.toBeInstanceOf(UserError);
    expect(c.usersListCalls.length).toBe(1);
    // 2 回目: 同じ sentinel を渡す → API 呼ばない
    await expect(
      resolveUser({
        db,
        client: c.client,
        team_id: TEAM,
        identifier: "@y",
        now: NOW,
        sentinel,
      }),
    ).rejects.toBeInstanceOf(UserError);
    expect(c.usersListCalls.length).toBe(1);
  });

  it("(9) 識別子形式不正 (`??invalid??`) → UserError", async () => {
    const c = buildClient({});
    const sentinel = newResolveUserSentinel();
    await expect(
      resolveUser({
        db,
        client: c.client,
        team_id: TEAM,
        identifier: "??invalid??",
        now: NOW,
        sentinel,
      }),
    ).rejects.toBeInstanceOf(UserError);
  });

  it("(10) email + lookupByEmail throw users_not_found → 例外をそのまま re-throw (handler が classify)", async () => {
    const apiErr = Object.assign(new Error("platform error"), {
      code: "slack_webapi_platform_error",
      data: { error: "users_not_found" },
    });
    const c = buildClient({
      usersLookupByEmail: { mode: "throw", error: apiErr },
    });
    const sentinel = newResolveUserSentinel();
    let caught: unknown;
    try {
      await resolveUser({
        db,
        client: c.client,
        team_id: TEAM,
        identifier: "nope@x.com",
        now: NOW,
        sentinel,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBe(apiErr);
  });

  it("(11) @Alice + cache hit (case-insensitive name lookup)", async () => {
    usersDao.upsert(db, makeUser({ user_id: "U1", name: "alice" }));
    const c = buildClient({});
    const sentinel = newResolveUserSentinel();
    const row = await resolveUser({
      db,
      client: c.client,
      team_id: TEAM,
      identifier: "@Alice",
      now: NOW,
      sentinel,
    });
    expect(c.usersListCalls.length).toBe(0);
    expect(row.user_id).toBe("U1");
  });

  it("(12) usersList pagination ループ上限 → UserError 'too many users'", async () => {
    // 200 ページ全部 next_cursor 非空 → 上限到達
    const pages: { members: unknown[]; response_metadata: { next_cursor: string } }[] = [];
    for (let i = 0; i < 250; i++) {
      pages.push({
        members: [{ id: `U${i}`, name: `u${i}` }],
        response_metadata: { next_cursor: `cur${i}` },
      });
    }
    const c = buildClient({ usersList: { pages } });
    const sentinel = newResolveUserSentinel();
    let caught: unknown;
    try {
      await resolveUser({
        db,
        client: c.client,
        team_id: TEAM,
        identifier: "@deep",
        now: NOW,
        sentinel,
      });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(UserError);
    expect((caught as UserError).message).toContain("too many users to scan");
    expect(c.usersListCalls.length).toBe(200);
  });

  it("(13) profile_json round-trip: member 全体が JSON で保管される", async () => {
    const member = {
      id: "U9",
      name: "kate",
      real_name: "Kate",
      tz: "Asia/Tokyo",
      is_bot: false,
      profile: {
        real_name: "Kate Real",
        email: "kate@example.com",
        image_72: "https://x/p.png",
        status_text: "busy",
      },
    };
    const c = buildClient({
      usersInfo: { mode: "ok", response: { ok: true, user: member } },
    });
    const sentinel = newResolveUserSentinel();
    const row = await resolveUser({
      db,
      client: c.client,
      team_id: TEAM,
      identifier: "U9",
      now: NOW,
      sentinel,
    });
    expect(row.profile_json).not.toBeNull();
    const parsed = JSON.parse(row.profile_json ?? "null") as Record<string, unknown>;
    expect(parsed.tz).toBe("Asia/Tokyo");
    expect(parsed.is_bot).toBe(false);
    expect((parsed.profile as Record<string, unknown>).status_text).toBe("busy");
  });
});
