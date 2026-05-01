import { describe, expect, it } from "bun:test";
import {
  type DownloadResult,
  renderDownloadResult,
} from "../../../../src/cli/commands/download/output.ts";

function res(overrides: Partial<DownloadResult> = {}): DownloadResult {
  return {
    ok: true,
    file_id: "F08K9XZAB1B",
    name: "screenshot.png",
    local_path: "/Users/yamamoto/Library/Application Support/slack-chan/files/T9Q9/F08K9XZAB1B.png",
    skipped: false,
    size_bytes: 126362,
    mimetype: "image/png",
    ...overrides,
  };
}

describe("renderDownloadResult human format", () => {
  it("new download → ✓ + name + path + size", () => {
    const out = renderDownloadResult(res(), "human", { isTTY: false });
    expect(out).toBe(
      "✓ F08K9XZAB1B (screenshot.png) → /Users/yamamoto/Library/Application Support/slack-chan/files/T9Q9/F08K9XZAB1B.png (123.4 KiB)\n",
    );
  });

  it("skipped download → ↺ skipped: prefix", () => {
    const out = renderDownloadResult(res({ skipped: true }), "human", { isTTY: false });
    expect(out.startsWith("↺ skipped:")).toBe(true);
  });

  it("no name → just file_id", () => {
    const out = renderDownloadResult(res({ name: undefined }), "human", { isTTY: false });
    expect(out).toContain("✓ F08K9XZAB1B → ");
    expect(out).not.toContain("(screenshot.png)");
  });

  it("no size → no size suffix", () => {
    const out = renderDownloadResult(res({ size_bytes: undefined }), "human", { isTTY: false });
    expect(out).not.toContain("KiB");
    expect(out).not.toContain("(0 B)");
  });

  it("colors=on: ✓ wrapped with green ANSI", () => {
    const out = renderDownloadResult(res(), "human", { isTTY: true });
    expect(out).toMatch(/\[32m/);
  });

  it("jsonl format unchanged (regression)", () => {
    const out = renderDownloadResult(res(), "jsonl");
    expect(out).toContain('"file_id":"F08K9XZAB1B"');
    expect(out).toContain('"skipped":false');
    expect(out).toContain('"local_path":');
  });
});
