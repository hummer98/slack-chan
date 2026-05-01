import { parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const USAGE =
  "Usage: slack-chan post <channel> <text> [--workspace=<id>] [--thread=<ts>] [--file=<path>] [--blocks=<json|path>]";

export interface PostArgs {
  channel: string;
  text: string;
  thread?: string;
  file?: string;
  blocks?: string;
}

const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{1,32}$/;
const CHANNEL_NAME_RE = /^[a-z0-9._-]{1,80}$/;
const THREAD_TS_RE = /^\d{10,}\.\d{4,}$/;

function hasDisallowedControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x09 || c === 0x0a) continue; // allow \t, \n
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function validateChannel(arg: string): void {
  if (arg.length === 0) {
    throw new UserError(`post: <channel> must be a non-empty string.\n${USAGE}`);
  }
  if (hasDisallowedControlChar(arg)) {
    throw new UserError(`post: <channel> must not contain control characters.\n${USAGE}`);
  }
  if (CHANNEL_ID_RE.test(arg)) return;
  const stripped = arg.startsWith("#") ? arg.slice(1) : arg;
  if (stripped.length > 0 && CHANNEL_NAME_RE.test(stripped)) return;
  throw new UserError(
    `post: <channel> '${arg}' is not a valid channel id (Cxxx/Gxxx/Dxxx) or name (alphanumerics/_/-/.).\n${USAGE}`,
  );
}

function validateText(arg: string): void {
  if (arg.trim().length === 0) {
    throw new UserError(`post: <text> must be a non-empty string.\n${USAGE}`);
  }
  if (hasDisallowedControlChar(arg)) {
    throw new UserError(
      `post: <text> must not contain C0 control characters (only \\n and \\t are allowed).\n${USAGE}`,
    );
  }
}

/**
 * Parse the `post` subcommand argv. `rest` already has global flags stripped
 * by `parseGlobalFlags`. Throws `UserError` on any input issue with a usage
 * line appended so the user sees the canonical invocation.
 */
export function parsePostArgv(rest: readonly string[]): PostArgs {
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...rest],
      options: {
        thread: { type: "string" },
        file: { type: "string" },
        blocks: { type: "string" },
      },
      strict: true,
      allowPositionals: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`post: ${msg}\n${USAGE}`);
  }

  const { positionals, values } = parsed;

  if (positionals.length === 0) {
    throw new UserError(`post: missing <channel>.\n${USAGE}`);
  }
  if (positionals.length === 1) {
    throw new UserError(`post: missing <text>.\n${USAGE}`);
  }
  if (positionals.length > 2) {
    throw new UserError(`post: too many arguments.\n${USAGE}`);
  }

  const [channel, text] = positionals as [string, string];
  validateChannel(channel);
  validateText(text);

  const thread = typeof values.thread === "string" ? values.thread : undefined;
  const file = typeof values.file === "string" ? values.file : undefined;
  const blocks = typeof values.blocks === "string" ? values.blocks : undefined;

  if (thread !== undefined && !THREAD_TS_RE.test(thread)) {
    throw new UserError(
      `post: --thread must match Slack ts format <unix>.<fraction>, got '${thread}'.\n${USAGE}`,
    );
  }
  if (blocks !== undefined && file !== undefined) {
    throw new UserError(
      `post: --blocks and --file are mutually exclusive (file uploads with blocks require chat.postMessage + files.upload chaining; out of scope for T012).\n${USAGE}`,
    );
  }

  const out: PostArgs = { channel, text };
  if (thread !== undefined) out.thread = thread;
  if (file !== undefined) out.file = file;
  if (blocks !== undefined) out.blocks = blocks;
  return out;
}
