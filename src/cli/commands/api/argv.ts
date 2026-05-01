import { parseArgs } from "node:util";
import { UserError } from "../../errors.ts";

export const USAGE = "Usage: slack-chan api <method> [k=v ...] [k:=<json> ...] --workspace=<id>";

export interface ApiArgs {
  /** Slack Web API method, e.g. "conversations.info". */
  method: string;
  /** Raw "k=v" / "k:=<json>" tokens, in argv order. */
  rawParams: readonly string[];
}

const METHOD_RE = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;

function validateMethod(method: string): void {
  if (!METHOD_RE.test(method)) {
    throw new UserError(
      `api: <method> '${method}' is not a valid Slack API method name.\n${USAGE}`,
    );
  }
}

/**
 * Parse the `api` subcommand argv. `rest` already has global flags
 * (`--workspace`, `--format`, etc.) stripped. The subcommand itself defines
 * no flags — every remaining `--foo` is rejected as unknown.
 */
export function parseApiArgv(rest: readonly string[]): ApiArgs {
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
    throw new UserError(`api: ${msg}\n${USAGE}`);
  }

  const { positionals } = parsed;
  const method = positionals[0];
  if (method === undefined) {
    throw new UserError(`api: missing <method>.\n${USAGE}`);
  }
  validateMethod(method);

  return { method, rawParams: positionals.slice(1) };
}
