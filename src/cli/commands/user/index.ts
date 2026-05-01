import { UserError } from "../../errors.ts";
import { EXIT_USER_ERROR } from "../../exit-codes.ts";
import type { CommandHandler } from "../../router.ts";
import { defaultEffects } from "./effects.ts";
import { handleUser } from "./handler.ts";

/**
 * `slack-chan user` entry. Mirrors `commands/post/index.ts` and
 * `commands/download/index.ts`: `runCli` already maps `CliError` subclasses
 * to exit codes, but a `UserError` is logged via `ctx.logger` for consistency
 * with the `config` family.
 */
export const userCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  try {
    return await handleUser(ctx, effects);
  } catch (e) {
    if (e instanceof UserError) {
      ctx.logger.error(e.message);
      return EXIT_USER_ERROR;
    }
    throw e;
  }
};
