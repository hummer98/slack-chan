#!/usr/bin/env bun
import pkg from "../../package.json" with { type: "json" };
import { StderrLogger } from "../output/logger.ts";
import { redactSecrets } from "../slack/redact.ts";
import { type CliError, toCliError } from "./errors.ts";
import { EXIT_INTERNAL, EXIT_OK } from "./exit-codes.ts";
import { parseGlobalFlags } from "./flags.ts";
import { buildTopLevelHelp } from "./help.ts";
import { type CommandContext, dispatch } from "./router.ts";

function serialize(e: unknown): string {
  if (e instanceof Error) return e.stack ?? `${e.name}: ${e.message}`;
  return String(e);
}

function redactString(s: string): string {
  // redactSecrets returns the same primitive type for strings (src/slack/redact.ts:16-18).
  return redactSecrets(s) as string;
}

/**
 * Install process-level handlers so that exceptions escaping `runCli` (timers,
 * unawaited promises, event emitters) are still redacted and produce
 * `EXIT_INTERNAL` instead of an opaque crash. Exposed as a function purely so
 * tests can invoke it directly without re-importing the module.
 */
export function installGlobalHandlers(): void {
  process.on("uncaughtException", (err) => {
    process.stderr.write(`uncaughtException: ${redactString(serialize(err))}\n`);
    process.exit(EXIT_INTERNAL);
  });
  process.on("unhandledRejection", (reason) => {
    process.stderr.write(`unhandledRejection: ${redactString(serialize(reason))}\n`);
    process.exit(EXIT_INTERNAL);
  });
}

export async function runCli(rawArgs: readonly string[]): Promise<number> {
  const logger = new StderrLogger();
  try {
    const parsed = parseGlobalFlags(rawArgs);

    if (parsed.global.verbose) logger.setLevel("debug");

    if (parsed.global.help) {
      process.stdout.write(buildTopLevelHelp());
      return EXIT_OK;
    }
    if (parsed.global.version) {
      process.stdout.write(`${pkg.version}\n`);
      return EXIT_OK;
    }
    // T009 暫定: subcommand 個別 --help は top-level help を返す（plan §4 / U6 申し送り）。
    if (parsed.subcommand !== null && parsed.rest.includes("--help")) {
      process.stdout.write(buildTopLevelHelp());
      return EXIT_OK;
    }

    const ctx: CommandContext = {
      workspace: parsed.global.workspace,
      format: parsed.global.format,
      verbose: parsed.global.verbose,
      rest: parsed.rest,
      logger,
    };
    return await dispatch(parsed.subcommand, ctx);
  } catch (err) {
    const cli: CliError = toCliError(err);
    process.stderr.write(`error: ${redactString(cli.message)}\n`);
    if (
      (process.env.SLACK_CHAN_DEBUG === "1" || process.env.SLACK_CHAN_DEBUG === "true") &&
      err instanceof Error &&
      typeof err.stack === "string"
    ) {
      process.stderr.write(`${redactString(err.stack)}\n`);
    }
    return cli.exitCode;
  }
}

// Bun sets `import.meta.main = true` only for the entry script. This guards
// against `bun test` (or unit tests) accidentally executing the CLI on import.
if (import.meta.main) {
  installGlobalHandlers();
  const code = await runCli(process.argv.slice(2));
  process.exit(code);
}
