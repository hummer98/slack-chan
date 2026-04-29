import { type ParseArgsConfig, parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const SYNC_USAGE = "Usage: slack-chan sync <channel> [--workspace=<T...>] [--full]";

export interface SyncArgs {
  channel: string;
  full: boolean;
}

const OPTIONS: ParseArgsConfig["options"] = {
  full: { type: "boolean" },
};

interface SyncFlagValues {
  full?: boolean;
}

export function parseSyncArgv(rest: readonly string[]): SyncArgs {
  let parsed: { values: SyncFlagValues; positionals: string[] };
  try {
    const r = parseArgs({
      args: [...rest],
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    parsed = { values: r.values as SyncFlagValues, positionals: r.positionals };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`sync: ${msg}\n${SYNC_USAGE}`);
  }

  if (parsed.positionals.length === 0) {
    throw new UserError(`sync: <channel> is required.\n${SYNC_USAGE}`);
  }
  if (parsed.positionals.length > 1) {
    throw new UserError(
      `sync: too many arguments (got ${parsed.positionals.length}).\n${SYNC_USAGE}`,
    );
  }
  const channel = parsed.positionals[0] as string;

  return {
    channel,
    full: parsed.values.full === true,
  };
}
