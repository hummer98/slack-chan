import { parseArgs } from "node:util";
import type { OutputFormat } from "../config/types.ts";
import { UserError } from "./errors.ts";

export interface GlobalFlags {
  /** Raw `--workspace` value or null when unspecified. T010 will add config/env fallback + format validation here. */
  workspace: string | null;
  format: OutputFormat;
  verbose: boolean;
  help: boolean;
  version: boolean;
}

export interface ParsedArgs {
  global: GlobalFlags;
  /** First positional after global flags. Null when no subcommand was supplied. */
  subcommand: string | null;
  /** Args belonging to the subcommand (positionals after subcommand + subcommand-specific flags). */
  rest: readonly string[];
}

const GLOBAL_NAMES: ReadonlySet<string> = new Set([
  "workspace",
  "json",
  "toon",
  "human",
  "verbose",
  "help",
  "version",
]);

/**
 * Resolve the default `--json|--toon|--human` choice when no flag is supplied.
 * Currently returns `"jsonl"` unconditionally; T010 will replace the body with
 * `await getOutputFormat()` to honour config / `SLACK_CHAN_OUTPUT_FORMAT`.
 */
function resolveDefaultFormat(): OutputFormat {
  // TODO(T010): replace with `await getOutputFormat()` from src/config/api.ts
  return "jsonl";
}

export function parseGlobalFlags(rawArgs: readonly string[]): ParsedArgs {
  const args = [...rawArgs];

  const { values, tokens } = parseArgs({
    args,
    options: {
      workspace: { type: "string" },
      json: { type: "boolean" },
      toon: { type: "boolean" },
      human: { type: "boolean" },
      verbose: { type: "boolean" },
      help: { type: "boolean", short: "h" },
      version: { type: "boolean", short: "v" },
    },
    strict: false,
    allowPositionals: true,
    tokens: true,
  });

  // Format exclusivity: at most one of --json / --toon / --human may be set.
  const formatFlags = [values.json, values.toon, values.human].filter(Boolean).length;
  if (formatFlags > 1) {
    throw new UserError("--json / --toon / --human are mutually exclusive.");
  }

  let format: OutputFormat;
  if (values.json === true) format = "jsonl";
  else if (values.toon === true) format = "toon";
  else if (values.human === true) format = "human";
  else format = resolveDefaultFormat();

  // Identify the subcommand boundary: the first `positional` token in arg order.
  let subcommandArgIdx = -1;
  let subcommand: string | null = null;
  for (const t of tokens) {
    if (t.kind === "positional") {
      subcommandArgIdx = t.index;
      subcommand = t.value;
      break;
    }
  }

  // Mark the arg indices consumed by global option tokens so we can excise them
  // from `rest`. `inlineValue: false` (space-separated) consumes the next arg too.
  const skip = new Set<number>();
  for (const t of tokens) {
    if (t.kind !== "option") continue;
    if (!GLOBAL_NAMES.has(t.name)) continue;
    skip.add(t.index);
    if (t.inlineValue === false) {
      skip.add(t.index + 1);
    }
  }

  // rest = all args after the subcommand boundary, minus global flag args.
  const rest: string[] = [];
  const start = subcommandArgIdx === -1 ? args.length : subcommandArgIdx + 1;
  for (let i = start; i < args.length; i++) {
    if (skip.has(i)) continue;
    const arg = args[i];
    if (arg !== undefined) rest.push(arg);
  }

  return {
    global: {
      workspace: typeof values.workspace === "string" ? values.workspace : null,
      format,
      verbose: values.verbose === true,
      help: values.help === true,
      version: values.version === true,
    },
    subcommand,
    rest,
  };
}
