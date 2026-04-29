import type { OutputFormat } from "../config/types.ts";
import type { Logger } from "../output/logger.ts";
import { COMMANDS } from "./commands/index.ts";
import { UserError } from "./errors.ts";
import { EXIT_OK } from "./exit-codes.ts";
import { buildTopLevelHelp } from "./help.ts";

export interface CommandContext {
  /** Resolved `--workspace` (raw value or null in T009; T010 will add config/env fallback). */
  workspace: string | null;
  format: OutputFormat;
  verbose: boolean;
  /** Args belonging to the subcommand (positionals after subcommand name + subcommand flags). */
  rest: readonly string[];
  logger: Logger;
}

export type CommandHandler = (ctx: CommandContext) => Promise<number>;

export async function dispatch(name: string | null, ctx: CommandContext): Promise<number> {
  if (name === null) {
    process.stdout.write(buildTopLevelHelp());
    return EXIT_OK;
  }
  const handler = (COMMANDS as Record<string, CommandHandler | undefined>)[name];
  if (!handler) {
    throw new UserError(`Unknown subcommand: ${name}. See 'slack-chan --help'.`);
  }
  return handler(ctx);
}
