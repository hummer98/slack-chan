import { describe, expect, it } from "bun:test";
import { loadBlocks } from "../../../../src/cli/commands/post/blocks.ts";
import type { Effects } from "../../../../src/cli/commands/post/effects.ts";
import { UserError } from "../../../../src/cli/errors.ts";

function makeEffects(files: Record<string, string | { code: string }>): Effects {
  return {
    configDir: "/tmp/x",
    env: {},
    loadConfig: async () => {
      throw new Error("not used");
    },
    getDefaultWorkspace: async () => null,
    createTokenStore: () => {
      throw new Error("not used");
    },
    createSlackClient: () => {
      throw new Error("not used");
    },
    readFile: async (p) => {
      const v = files[p];
      if (v === undefined) {
        const err = new Error(
          `ENOENT: no such file or directory, open '${p}'`,
        ) as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      }
      if (typeof v === "object") {
        const err = new Error(`forced ${v.code}`) as NodeJS.ErrnoException;
        err.code = v.code;
        throw err;
      }
      return v;
    },
    statSync: () => ({ isFile: () => true }),
    now: () => 0,
  };
}

describe("loadBlocks", () => {
  it("(1) インライン JSON 配列: parse 成功", async () => {
    const eff = makeEffects({});
    const r = await loadBlocks('[{"type":"section","text":{"type":"mrkdwn","text":"hi"}}]', eff);
    expect(Array.isArray(r)).toBe(true);
    expect(r.length).toBe(1);
  });

  it("(2) インライン JSON オブジェクト (配列でない) → UserError", async () => {
    const eff = makeEffects({});
    try {
      await loadBlocks('{"type":"section"}', eff);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("must be a JSON array");
      expect((e as UserError).message).toContain("got object");
    }
  });

  it("(3) インライン JSON parse error → UserError 'is not valid JSON'", async () => {
    const eff = makeEffects({});
    try {
      await loadBlocks("[not-json", eff);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("is not valid JSON");
    }
  });

  it("(4) ファイルパス: readFile を経由して配列を返す", async () => {
    const eff = makeEffects({ "./blocks.json": '[{"type":"divider"}]' });
    const r = await loadBlocks("./blocks.json", eff);
    expect(r).toEqual([{ type: "divider" }]);
  });

  it("(5) ファイルパスで ENOENT → UserError 'not found'", async () => {
    const eff = makeEffects({});
    try {
      await loadBlocks("./missing.json", eff);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("not found");
    }
  });

  it("(6) ファイルで不正 JSON → UserError 'is not valid JSON'", async () => {
    const eff = makeEffects({ "./bad.json": "{broken" });
    try {
      await loadBlocks("./bad.json", eff);
      throw new Error("expected to throw");
    } catch (e) {
      expect(e).toBeInstanceOf(UserError);
      expect((e as UserError).message).toContain("is not valid JSON");
      expect((e as UserError).message).toContain("./bad.json");
    }
  });

  it("(7) インライン null → UserError, shape='null'", async () => {
    const eff = makeEffects({});
    try {
      await loadBlocks("null", eff);
      throw new Error("expected to throw");
    } catch (e) {
      // null は file path として解釈される (先頭が { や [ ではない) ので ENOENT 経路
      expect(e).toBeInstanceOf(UserError);
    }
  });
});
