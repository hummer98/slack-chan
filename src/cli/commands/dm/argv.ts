import { parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const DM_USAGE =
  "Usage:\n" +
  "  slack-chan dm <user> <text> [--workspace=<T>] [--thread=<ts>] [--file=<path>] [--blocks=<json|path>]\n" +
  "  slack-chan dm <user> --read [--workspace=<T>] [--limit=N] [--since=<dur>] [--thread=<ts>] [--refresh] [--full-edit-scan]";

export type UserKind = "id" | "email" | "name";

const ID_RE = /^[UW][A-Z0-9]{1,32}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const THREAD_TS_RE = /^\d{10}\.\d{6}$/;
const MAX_USER_LEN = 256;

export interface DmPostArgs {
  mode: "post";
  user: string;
  userKind: UserKind;
  text: string;
  thread?: string;
  file?: string;
  blocks?: string;
}

export interface DmReadArgs {
  mode: "read";
  user: string;
  userKind: UserKind;
  limit?: string;
  since?: string;
  thread?: string;
  refresh: boolean;
  fullEditScan: boolean;
}

export type DmArgs = DmPostArgs | DmReadArgs;

interface DmFlagValues {
  read?: boolean;
  thread?: string;
  file?: string;
  blocks?: string;
  limit?: string;
  since?: string;
  refresh?: boolean;
  "full-edit-scan"?: boolean;
}

function hasDisallowedControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x09 || c === 0x0a) continue;
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export function classifyUser(arg: string): UserKind {
  if (arg.length === 0) {
    throw new UserError(`dm: <user> must be a non-empty string.\n${DM_USAGE}`);
  }
  if (arg.length > MAX_USER_LEN) {
    throw new UserError(`dm: <user> is too long (max ${MAX_USER_LEN} chars).\n${DM_USAGE}`);
  }
  if (hasDisallowedControlChar(arg)) {
    throw new UserError(`dm: <user> must not contain control characters.\n${DM_USAGE}`);
  }
  if (ID_RE.test(arg)) return "id";
  if (arg.startsWith("@")) {
    if (arg.length === 1) {
      throw new UserError(`dm: <user> '@' alone is not a valid name.\n${DM_USAGE}`);
    }
    return "name";
  }
  if (EMAIL_RE.test(arg)) return "email";
  throw new UserError(`dm: <user> '${arg}' is not a valid Uxxx id, email, or @name.\n${DM_USAGE}`);
}

function validateText(arg: string): void {
  if (arg.trim().length === 0) {
    throw new UserError(`dm: <text> must be a non-empty string.\n${DM_USAGE}`);
  }
  if (hasDisallowedControlChar(arg)) {
    throw new UserError(
      `dm: <text> must not contain C0 control characters (only \\n and \\t are allowed).\n${DM_USAGE}`,
    );
  }
}

export function parseDmArgv(rest: readonly string[]): DmArgs {
  let parsed: { values: DmFlagValues; positionals: string[] };
  try {
    const r = parseArgs({
      args: [...rest],
      options: {
        read: { type: "boolean" },
        thread: { type: "string" },
        file: { type: "string" },
        blocks: { type: "string" },
        limit: { type: "string" },
        since: { type: "string" },
        refresh: { type: "boolean" },
        "full-edit-scan": { type: "boolean" },
      },
      strict: true,
      allowPositionals: true,
    });
    parsed = { values: r.values as DmFlagValues, positionals: r.positionals };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`dm: ${msg}\n${DM_USAGE}`);
  }

  const { positionals, values } = parsed;
  const isRead = values.read === true;

  if (positionals.length === 0) {
    throw new UserError(`dm: missing <user>.\n${DM_USAGE}`);
  }

  const user = positionals[0] as string;
  const userKind = classifyUser(user);

  if (isRead) {
    if (positionals.length > 1) {
      throw new UserError(
        `dm: too many positional arguments for --read mode (got ${positionals.length}).\n${DM_USAGE}`,
      );
    }
    if (values.file !== undefined || values.blocks !== undefined) {
      throw new UserError(`dm: --file / --blocks cannot be combined with --read.\n${DM_USAGE}`);
    }
    if (values.thread !== undefined && !THREAD_TS_RE.test(values.thread)) {
      throw new UserError(
        `dm: --thread="${values.thread}" is not a valid Slack ts (expected 1700000000.000100 form).\n${DM_USAGE}`,
      );
    }
    const out: DmReadArgs = {
      mode: "read",
      user,
      userKind,
      refresh: values.refresh === true,
      fullEditScan: values["full-edit-scan"] === true,
    };
    if (values.limit !== undefined) out.limit = values.limit;
    if (values.since !== undefined) out.since = values.since;
    if (values.thread !== undefined) out.thread = values.thread;
    return out;
  }

  if (positionals.length === 1) {
    throw new UserError(`dm: missing <text>.\n${DM_USAGE}`);
  }
  if (positionals.length > 2) {
    throw new UserError(`dm: too many arguments.\n${DM_USAGE}`);
  }

  if (
    values.limit !== undefined ||
    values.since !== undefined ||
    values.refresh === true ||
    values["full-edit-scan"] === true
  ) {
    throw new UserError(
      `dm: --limit / --since / --refresh / --full-edit-scan are only valid with --read.\n${DM_USAGE}`,
    );
  }

  const text = positionals[1] as string;
  validateText(text);

  if (values.thread !== undefined && !/^\d{10,}\.\d{4,}$/.test(values.thread)) {
    throw new UserError(
      `dm: --thread must match Slack ts format <unix>.<fraction>, got '${values.thread}'.\n${DM_USAGE}`,
    );
  }
  if (values.blocks !== undefined && values.file !== undefined) {
    throw new UserError(`dm: --blocks and --file are mutually exclusive.\n${DM_USAGE}`);
  }

  const out: DmPostArgs = {
    mode: "post",
    user,
    userKind,
    text,
  };
  if (values.thread !== undefined) out.thread = values.thread;
  if (values.file !== undefined) out.file = values.file;
  if (values.blocks !== undefined) out.blocks = values.blocks;
  return out;
}
