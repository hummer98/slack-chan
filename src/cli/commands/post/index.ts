import { UserError } from "../../errors.ts";
import { EXIT_USER_ERROR } from "../../exit-codes.ts";
import type { CommandHandler } from "../../router.ts";
import { defaultEffects } from "./effects.ts";
import { handlePost } from "./handler.ts";

/**
 * `slack-chan post` entry. `runCli` already catches `CliError` subclasses and
 * maps them to exit codes, but a `UserError` should also be logged via the
 * subcommand's `ctx.logger` for consistency with the `config` family. This
 * mirrors `runWithUserErrorReturn` in `commands/config/index.ts`.
 */
export const postCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  try {
    return await handlePost(ctx, effects);
  } catch (e) {
    if (e instanceof UserError) {
      ctx.logger.error(e.message);
      return EXIT_USER_ERROR;
    }
    throw e;
  }
};
