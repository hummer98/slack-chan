import { UserError } from "../../errors.ts";
import { EXIT_USER_ERROR } from "../../exit-codes.ts";
import type { CommandHandler } from "../../router.ts";
import { defaultEffects } from "./effects.ts";
import { handleDownload } from "./handler.ts";

/**
 * `slack-chan download` entry. Mirrors `commands/post/index.ts`: the outer
 * dispatcher catches `CliError` subclasses, but a `UserError` is also
 * surfaced via `ctx.logger` so the message renders consistently with the
 * `config` family.
 */
export const downloadCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  try {
    return await handleDownload(ctx, effects);
  } catch (e) {
    if (e instanceof UserError) {
      ctx.logger.error(e.message);
      return EXIT_USER_ERROR;
    }
    throw e;
  }
};
