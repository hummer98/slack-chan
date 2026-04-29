import { type ParseArgsConfig, parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export interface ParsedConfigArgs<O> {
  values: O;
  positionals: string[];
}

export interface ParseConfigArgvContext {
  command: string;
  usage: string;
}

/**
 * Run `node:util.parseArgs` for a sub-sub command and re-throw any failure as a
 * `UserError` whose message is `"<command>: <reason>\n<usage>"`. `strict: true`
 * is intentional — global flags have already been stripped by `parseGlobalFlags`,
 * so any unknown option here is a real typo.
 */
export function parseConfigArgv<O extends Record<string, unknown>>(
  rest: readonly string[],
  options: ParseArgsConfig["options"],
  context: ParseConfigArgvContext,
): ParsedConfigArgs<O> {
  try {
    const r = parseArgs({
      args: [...rest],
      options,
      strict: true,
      allowPositionals: true,
    });
    return { values: r.values as O, positionals: r.positionals };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`${context.command}: ${msg}\n${context.usage}`);
  }
}
