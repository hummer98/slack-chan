import { parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const USAGE =
  "Usage: slack-chan download <ts> [--workspace=<id>] [--channel=<id|name>] [--out=<dir>] [--force]";

export interface DownloadArgs {
  ts: string;
  channel?: string;
  out?: string;
  force: boolean;
}

const TS_RE = /^\d{10,}\.\d{4,}$/;
const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{1,32}$/;
const CHANNEL_NAME_RE = /^[a-z0-9._-]{1,80}$/;

function hasDisallowedControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x09 || c === 0x0a) continue; // allow \t, \n
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function validateTs(arg: string): void {
  if (arg.length === 0) {
    throw new UserError(`download: <ts> must be a non-empty string.\n${USAGE}`);
  }
  if (hasDisallowedControlChar(arg)) {
    throw new UserError(`download: <ts> must not contain control characters.\n${USAGE}`);
  }
  if (!TS_RE.test(arg)) {
    throw new UserError(
      `download: <ts> must match Slack ts format <unix>.<fraction>, got '${arg}'.\n${USAGE}`,
    );
  }
}

function validateChannel(arg: string): void {
  if (arg.length === 0) {
    throw new UserError(`download: --channel must be a non-empty string.\n${USAGE}`);
  }
  if (hasDisallowedControlChar(arg)) {
    throw new UserError(`download: --channel must not contain control characters.\n${USAGE}`);
  }
  if (CHANNEL_ID_RE.test(arg)) return;
  const stripped = arg.startsWith("#") ? arg.slice(1) : arg;
  if (stripped.length > 0 && CHANNEL_NAME_RE.test(stripped)) return;
  throw new UserError(
    `download: --channel '${arg}' is not a valid channel id (Cxxx/Gxxx/Dxxx) or name (alphanumerics/_/-/.).\n${USAGE}`,
  );
}

function validateOut(arg: string): void {
  if (arg.length === 0) {
    throw new UserError(`download: --out must be a non-empty string.\n${USAGE}`);
  }
  if (hasDisallowedControlChar(arg)) {
    throw new UserError(`download: --out must not contain control characters.\n${USAGE}`);
  }
}

/**
 * Parse the `download` subcommand argv. `rest` already has global flags
 * stripped by `parseGlobalFlags`. Throws `UserError` on any input issue with
 * the canonical usage string appended (post と同じ慣習).
 *
 * `--force` の正規化方針 (I-2): `parseArgs` の boolean は未指定で `undefined`
 * を返すので、`values.force === true` で false に倒す。
 */
export function parseDownloadArgv(rest: readonly string[]): DownloadArgs {
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...rest],
      options: {
        channel: { type: "string" },
        out: { type: "string" },
        force: { type: "boolean" },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`download: ${msg}\n${USAGE}`);
  }

  const { positionals, values } = parsed;

  if (positionals.length === 0) {
    throw new UserError(`download: missing <ts>.\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new UserError(`download: too many arguments.\n${USAGE}`);
  }

  const [ts] = positionals as [string];
  validateTs(ts);

  const channel = typeof values.channel === "string" ? values.channel : undefined;
  const out = typeof values.out === "string" ? values.out : undefined;
  const force = values.force === true;

  if (channel !== undefined) validateChannel(channel);
  if (out !== undefined) validateOut(out);

  const result: DownloadArgs = { ts, force };
  if (channel !== undefined) result.channel = channel;
  if (out !== undefined) result.out = out;
  return result;
}
