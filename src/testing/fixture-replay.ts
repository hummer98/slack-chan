import { spyOn } from "bun:test";
import { readFileSync } from "node:fs";
import { WebClient } from "@slack/web-api";
import type { SlackFixture } from "./fixture-types.ts";

/**
 * Load a redacted Slack fixture and install it as a stub on
 * `WebClient.prototype.apiCall`. The caller is responsible for restoring the
 * mock — typically via `mock.restore()` inside `afterEach`.
 *
 * Throws if the JSON is unredacted (`redacted !== true`) or if the file is
 * unreadable / not parseable JSON.
 */
export function replayFixture(fixturePath: string): SlackFixture {
  const raw = readFileSync(fixturePath, "utf8");
  const parsed = JSON.parse(raw) as { redacted?: unknown } & SlackFixture;
  if (parsed.redacted !== true) {
    throw new Error(
      `replayFixture: refusing to use unredacted fixture (${fixturePath}). ` +
        `Run \`bun run redact-fixtures\` before committing.`,
    );
  }
  const fixture = parsed as SlackFixture;
  const proto = WebClient.prototype as unknown as {
    apiCall: (...args: unknown[]) => Promise<unknown>;
  };
  spyOn(proto, "apiCall").mockResolvedValue(fixture.data);
  return fixture;
}
