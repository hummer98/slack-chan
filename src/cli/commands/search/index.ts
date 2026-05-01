import type { CommandHandler } from "../../router.ts";
import { runWithUserErrorReturn } from "../config/index.ts";
import { defaultEffects } from "./effects.ts";
import { searchHandler } from "./handler.ts";

export const searchCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  return runWithUserErrorReturn(ctx, () => searchHandler(ctx, effects));
};
