import { type ParseArgsConfig, parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const STATS_USAGE = "Usage: slack-chan stats [--workspace=<T...>] [--json|--toon|--human]";

export type StatsArgs = Record<string, never>;

const OPTIONS: ParseArgsConfig["options"] = {};

export function parseStatsArgv(rest: readonly string[]): StatsArgs {
  let positionals: string[];
  try {
    const r = parseArgs({
      args: [...rest],
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    positionals = r.positionals;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`stats: ${msg}\n${STATS_USAGE}`);
  }

  if (positionals.length > 0) {
    throw new UserError(`stats: unexpected argument '${positionals[0]}'.\n${STATS_USAGE}`);
  }

  return {};
}
