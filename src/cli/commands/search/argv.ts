import { type ParseArgsConfig, parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const SEARCH_USAGE =
  "Usage: slack-chan search <query> [--workspace=<T...>] [--in=<channel>] " +
  "[--from=<user>] [--cached-only] [--limit=N] [--json|--toon|--human]";

export interface SearchArgs {
  query: string;
  in: string | null;
  from: string | null;
  cachedOnly: boolean;
  limit: number;
}

const OPTIONS: ParseArgsConfig["options"] = {
  in: { type: "string" },
  from: { type: "string" },
  "cached-only": { type: "boolean" },
  limit: { type: "string" },
};

interface SearchFlagValues {
  in?: string;
  from?: string;
  "cached-only"?: boolean;
  limit?: string;
}

function hasDisallowedControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c === 0x09 || c === 0x0a) continue;
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function parseLimit(raw: unknown): number {
  if (raw === undefined) return 50;
  if (typeof raw !== "string") {
    throw new UserError(`search: --limit must be an integer in [1, 1000].\n${SEARCH_USAGE}`);
  }
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1 || n > 1000) {
    throw new UserError(`search: --limit must be an integer in [1, 1000].\n${SEARCH_USAGE}`);
  }
  return n;
}

export function parseSearchArgv(rest: readonly string[]): SearchArgs {
  let parsed: { values: SearchFlagValues; positionals: string[] };
  try {
    const r = parseArgs({
      args: [...rest],
      options: OPTIONS,
      strict: true,
      allowPositionals: true,
    });
    parsed = { values: r.values as SearchFlagValues, positionals: r.positionals };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`search: ${msg}\n${SEARCH_USAGE}`);
  }

  if (parsed.positionals.length === 0) {
    throw new UserError(`search: <query> is required.\n${SEARCH_USAGE}`);
  }
  if (parsed.positionals.length > 1) {
    throw new UserError(
      `search: too many arguments (got ${parsed.positionals.length}). ` +
        'Quote the query if it contains spaces (e.g. slack-chan search "hello world").\n' +
        SEARCH_USAGE,
    );
  }

  const rawQuery = parsed.positionals[0] as string;
  if (rawQuery.trim().length === 0) {
    throw new UserError(`search: <query> must be a non-empty string.\n${SEARCH_USAGE}`);
  }
  if (hasDisallowedControlChar(rawQuery)) {
    throw new UserError(`search: <query> must not contain control characters.\n${SEARCH_USAGE}`);
  }

  const inRaw = parsed.values.in;
  let inVal: string | null = null;
  if (typeof inRaw === "string") {
    if (inRaw.length === 0) {
      throw new UserError(`search: --in must be a non-empty string.\n${SEARCH_USAGE}`);
    }
    if (hasDisallowedControlChar(inRaw)) {
      throw new UserError(`search: --in must not contain control characters.\n${SEARCH_USAGE}`);
    }
    inVal = inRaw;
  }

  const fromRaw = parsed.values.from;
  let fromVal: string | null = null;
  if (typeof fromRaw === "string") {
    if (fromRaw.length === 0) {
      throw new UserError(`search: --from must be a non-empty string.\n${SEARCH_USAGE}`);
    }
    if (hasDisallowedControlChar(fromRaw)) {
      throw new UserError(`search: --from must not contain control characters.\n${SEARCH_USAGE}`);
    }
    fromVal = fromRaw;
  }

  const limit = parseLimit(parsed.values.limit);

  return {
    query: rawQuery,
    in: inVal,
    from: fromVal,
    cachedOnly: parsed.values["cached-only"] === true,
    limit,
  };
}
