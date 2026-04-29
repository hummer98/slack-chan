import { parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const USAGE = "Usage: slack-chan user <id|email|@name> [--workspace=<id>]";

export interface UserArgs {
  identifier: string;
}

function hasDisallowedControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x09 || c === 0x0a) continue; // allow \t, \n
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function validateIdentifier(arg: string): void {
  if (arg.trim().length === 0) {
    throw new UserError(`user: <identifier> must be a non-empty string.\n${USAGE}`);
  }
  if (hasDisallowedControlChar(arg)) {
    throw new UserError(`user: <identifier> must not contain control characters.\n${USAGE}`);
  }
}

/**
 * Parse the `user` subcommand argv. `rest` already has global flags stripped
 * by `parseGlobalFlags`. argv 段階では「非空 / 制御文字なし」のみ検査し、
 * id / email / @name の種別判定は resolveUser 側で行う。
 */
export function parseUserArgv(rest: readonly string[]): UserArgs {
  let parsed: { values: Record<string, unknown>; positionals: string[] };
  try {
    parsed = parseArgs({
      args: [...rest],
      options: {},
      strict: true,
      allowPositionals: true,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`user: ${msg}\n${USAGE}`);
  }

  const { positionals } = parsed;

  if (positionals.length === 0) {
    throw new UserError(`user: missing <identifier>.\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new UserError(`user: too many arguments.\n${USAGE}`);
  }

  const [identifier] = positionals as [string];
  validateIdentifier(identifier);

  return { identifier };
}
