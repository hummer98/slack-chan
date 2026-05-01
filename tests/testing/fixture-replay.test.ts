import { afterEach, describe, expect, it, mock } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { WebClient } from "@slack/web-api";
import { replayFixture } from "../../src/testing/fixture-replay.ts";

function writeFixture(content: unknown): string {
  const dir = mkdtempSync(join(tmpdir(), "slack-chan-fixture-"));
  const path = join(dir, "fixture.json");
  writeFileSync(path, JSON.stringify(content), "utf8");
  return path;
}

describe("replayFixture", () => {
  afterEach(() => {
    mock.restore();
  });

  it("returns the fixture and stubs WebClient.apiCall to return its data", async () => {
    const path = writeFixture({
      method: "auth.test",
      params: null,
      status: 200,
      data: { ok: true, team: "T_TEST_001", user: "U_TEST_001" },
      recorded_at: "2026-04-29T00:00:00.000Z",
      redacted: true,
    });
    const fixture = replayFixture(path);
    expect(fixture.data.team).toBe("T_TEST_001");

    const client = new WebClient("xoxb-test-token");
    const res = await client.auth.test();
    expect(res.ok).toBe(true);
    expect(res.team).toBe("T_TEST_001");
    expect(res.user).toBe("U_TEST_001");
  });

  it("throws when the JSON has redacted: false", () => {
    const path = writeFixture({
      method: "auth.test",
      params: null,
      status: 200,
      data: { ok: true },
      recorded_at: "2026-04-29T00:00:00.000Z",
      redacted: false,
    });
    expect(() => replayFixture(path)).toThrow();
  });

  it("throws when the file does not exist", () => {
    expect(() => replayFixture("/nonexistent/path/to/fixture.json")).toThrow();
  });
});
