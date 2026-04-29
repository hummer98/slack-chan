import { UserError } from "../../errors.ts";
import { EXIT_USER_ERROR } from "../../exit-codes.ts";
import type { CommandHandler } from "../../router.ts";
import { defaultEffects } from "./effects.ts";
import { handleApi } from "./handler.ts";

/**
 * `slack-chan api` entry. `runCli` already maps `CliError` subclasses to exit
 * codes, but a `UserError` is also logged via `ctx.logger` for parity with
 * the other subcommand families (post / dm / read / user).
 */
export const apiCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  try {
    return await handleApi(ctx, effects);
  } catch (e) {
    if (e instanceof UserError) {
      ctx.logger.error(e.message);
      return EXIT_USER_ERROR;
    }
    throw e;
  }
};
