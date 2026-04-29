import { type ParseArgsConfig, parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const READ_USAGE =
  "Usage: slack-chan read <channel> [--workspace=<T...>] [--limit=N] [--since=<dur>] " +
  "[--thread=<ts>] [--refresh] [--full-edit-scan] [--json|--toon|--human]";

export interface ReadArgs {
  channel: string;
  limit: number;
  since_sec: number | null;
  thread: string | null;
  refresh: boolean;
  fullEditScan: boolean;
}

const OPTIONS: ParseArgsConfig["options"] = {
  limit: { type: "string" },
  since: { type: "string" },
  thread: { type: "string" },
  refresh: { type: "boolean" },
  "full-edit-scan": { type: "boolean" },
};

interface ReadFlagValues {
  limit?: string;
  since?: string;
  thread?: string;
  refresh?: boolean;
  "full-edit-scan"?: boolean;
}

export function parseReadArgv(rest: readonly string[]): ReadArgs {
  let parsed: { values: ReadFlagValues; positionals: string[] };
  try {
    const r = parseArgs({
      args: [...rest],
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    parsed = { values: r.values as ReadFlagValues, positionals: r.positionals };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`read: ${msg}\n${READ_USAGE}`);
  }

  if (parsed.positionals.length === 0) {
    throw new UserError(`read: <channel> is required.\n${READ_USAGE}`);
  }
  if (parsed.positionals.length > 1) {
    throw new UserError(
      `read: too many arguments (got ${parsed.positionals.length}).\n${READ_USAGE}`,
    );
  }
  const channel = parsed.positionals[0] as string;

  const limit = parseLimit(parsed.values.limit);
  const since_sec =
    typeof parsed.values.since === "string" ? parseSince(parsed.values.since) : null;
  const thread =
    typeof parsed.values.thread === "string" ? validateThreadTs(parsed.values.thread) : null;

  return {
    channel,
    limit,
    since_sec,
    thread,
    refresh: parsed.values.refresh === true,
    fullEditScan: parsed.values["full-edit-scan"] === true,
  };
}

const UNIT_TO_SEC: Record<string, number> = { s: 1, m: 60, h: 3600, d: 86400 };

export function parseSince(input: string): number {
  const m = /^(\d+)([smhd])$/.exec(input);
  if (!m) {
    throw new UserError(
      `read: --since="${input}" is not a valid duration. Expected forms: 7d, 3h, 30m, 600s.\n${READ_USAGE}`,
    );
  }
  const n = Number(m[1]);
  const unit = m[2] as string;
  if (!Number.isFinite(n) || n <= 0) {
    throw new UserError(
      `read: --since="${input}" must be a positive duration. Expected forms: 7d, 3h, 30m, 600s.\n${READ_USAGE}`,
    );
  }
  const factor = UNIT_TO_SEC[unit] as number;
  const sec = n * factor;
  if (sec > 365 * 86400) {
    throw new UserError(
      `read: --since=${input} exceeds 365 days. Use a smaller value.\n${READ_USAGE}`,
    );
  }
  return sec;
}

export function parseLimit(raw: unknown): number {
  if (raw === undefined) return 100;
  if (typeof raw !== "string") {
    throw new UserError(`read: --limit must be a positive integer.\n${READ_USAGE}`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new UserError(`read: --limit must be an integer in [1, 1000].\n${READ_USAGE}`);
  }
  return n;
}

export function validateThreadTs(s: string): string {
  if (!/^\d{10}\.\d{6}$/.test(s)) {
    throw new UserError(
      `read: --thread="${s}" is not a valid Slack ts (expected 1700000000.000100 form).\n${READ_USAGE}`,
    );
  }
  return s;
}
