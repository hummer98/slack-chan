import { describe, expect, it } from "bun:test";
import { Readable, Writable } from "node:stream";
import { promptYesNo } from "../../../../src/cli/commands/config/prompt.ts";
import { UserError } from "../../../../src/cli/errors.ts";

function devnull(): NodeJS.WritableStream {
  return new Writable({
    write(_chunk, _enc, cb) {
      cb();
    },
  });
}

describe("promptYesNo", () => {
  it("yes:true short-circuits without touching streams", async () => {
    // 故意に input を渡さない: ここで stdin に触れたらテストはハングするかエラーになる
    const ok = await promptYesNo({ question: "Delete?", yes: true });
    expect(ok).toBe(true);
  });

  it("non-TTY without --yes throws UserError", async () => {
    expect(promptYesNo({ question: "Delete?", isTTY: false })).rejects.toBeInstanceOf(UserError);
  });

  it("returns true on 'y\\n'", async () => {
    const input = Readable.from([Buffer.from("y\n")]);
    const ok = await promptYesNo({
      question: "Delete?",
      isTTY: true,
      input,
      output: devnull(),
    });
    expect(ok).toBe(true);
  });

  it("returns true on 'yes\\n' (case insensitive)", async () => {
    const input = Readable.from([Buffer.from("YES\n")]);
    const ok = await promptYesNo({
      question: "Delete?",
      isTTY: true,
      input,
      output: devnull(),
    });
    expect(ok).toBe(true);
  });

  it("returns false on 'n\\n'", async () => {
    const input = Readable.from([Buffer.from("n\n")]);
    const ok = await promptYesNo({
      question: "Delete?",
      isTTY: true,
      input,
      output: devnull(),
    });
    expect(ok).toBe(false);
  });

  it("returns false on empty input", async () => {
    const input = Readable.from([Buffer.from("\n")]);
    const ok = await promptYesNo({
      question: "Delete?",
      isTTY: true,
      input,
      output: devnull(),
    });
    expect(ok).toBe(false);
  });
});
