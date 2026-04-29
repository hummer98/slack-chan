import { afterEach, describe, expect, it, mock } from "bun:test";
import { resolveChannel } from "../../../../src/cli/commands/post/channels.ts";
import { UserError } from "../../../../src/cli/errors.ts";
import { SlackClient } from "../../../../src/slack/client.ts";

interface ChannelStub {
  id: string;
  name?: string;
  name_normalized?: string;
}

interface ListPage {
  channels: ChannelStub[];
  next_cursor?: string;
}

function makeClient(pages: ListPage[]): {
  client: SlackClient;
  calls: { args: unknown }[];
} {
  const calls: { args: unknown }[] = [];
  const client = new SlackClient({ team_id: "T01ABCDEF", token: "xoxb-test" });
  let i = 0;
  Object.defineProperty(client, "conversationsList", {
    value: async (args: unknown) => {
      calls.push({ args });
      const page = pages[i++];
      if (!page) {
        return { channels: [], response_metadata: {} };
      }
      return {
        channels: page.channels,
        response_metadata: page.next_cursor !== undefined ? { next_cursor: page.next_cursor } : {},
      };
    },
  });
  return { client, calls };
}

describe("resolveChannel", () => {
  afterEach(() => {
    mock.restore();
  });

  it("(1) Cxxxxxxxx 形式: API 呼ばれずそのまま返る", async () => {
    const { client, calls } = makeClient([]);
    const id = await resolveChannel("C0123ABCDEF", client);
    expect(id).toBe("C0123ABCDEF");
    expect(calls.length).toBe(0);
  });

  it("(2) Gxxxxxxxx 形式: そのまま返る", async () => {
    const { client, calls } = makeClient([]);
    expect(await resolveChannel("G01ABCDEF", client)).toBe("G01ABCDEF");
    expect(calls.length).toBe(0);
  });

  it("(3) Dxxxxxxxx 形式: そのまま返る", async () => {
    const { client, calls } = makeClient([]);
    expect(await resolveChannel("D01XYZ", client)).toBe("D01XYZ");
    expect(calls.length).toBe(0);
  });

  it("(4) #general → 1 ページ目で hit", async () => {
    const { client, calls } = makeClient([{ channels: [{ id: "C111", name: "general" }] }]);
    expect(await resolveChannel("#general", client)).toBe("C111");
    expect(calls.length).toBe(1);
  });

  it("(5) general (# なし) → 1 ページ目で hit", async () => {
    const { client } = makeClient([{ channels: [{ id: "C222", name: "general" }] }]);
    expect(await resolveChannel("general", client)).toBe("C222");
  });

  it("(6) 複数ページ paginate: page1 → next_cursor → page2 で hit", async () => {
    const { client, calls } = makeClient([
      { channels: [{ id: "C100", name: "other" }], next_cursor: "abc" },
      { channels: [{ id: "C200", name: "target" }] },
    ]);
    expect(await resolveChannel("target", client)).toBe("C200");
    expect(calls.length).toBe(2);
    // 2 page 目には cursor=abc が乗る
    expect((calls[1]?.args as { cursor?: string }).cursor).toBe("abc");
  });

  it("(7) 全ページ走査して見つからない → UserError 'not found'", async () => {
    const { client } = makeClient([
      { channels: [{ id: "C100", name: "other" }] }, // no next_cursor
    ]);
    try {
      await resolveChannel("missing", client);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not found");
    }
  });

  it("(8) ページ数上限 (21 ページ目) → UserError 'too many channels'", async () => {
    // 20 page 全てに next_cursor を付与する → loop 終了せず外側 throw
    const pages: ListPage[] = [];
    for (let i = 0; i < 30; i++) {
      pages.push({ channels: [{ id: `C${i}`, name: `chan${i}` }], next_cursor: `c${i}` });
    }
    const { client } = makeClient(pages);
    try {
      await resolveChannel("missing", client);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("too many channels");
    }
  });

  it("(9) name_normalized で hit (lower-case 比較)", async () => {
    const { client } = makeClient([
      { channels: [{ id: "C300", name: "Capital", name_normalized: "capital" }] },
    ]);
    expect(await resolveChannel("capital", client)).toBe("C300");
  });

  it("(10) 重複ヒット (ambiguous) → UserError、両 ID を含む", async () => {
    const { client, calls } = makeClient([
      { channels: [{ id: "C111", name: "general" }], next_cursor: "p2" },
      { channels: [{ id: "C222", name_normalized: "general" }] },
    ]);
    try {
      await resolveChannel("general", client);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      const msg = (e as UserError).message;
      expect(msg).toContain("ambiguous");
      expect(msg).toContain("'general'");
      expect(msg).toContain("C111");
      expect(msg).toContain("C222");
    }
    // 全 page を走査することを確認
    expect(calls.length).toBe(2);
  });
});
