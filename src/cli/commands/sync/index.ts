import type { CommandHandler } from "../../router.ts";
import { runWithUserErrorReturn } from "../config/index.ts";
import { defaultEffects } from "./effects.ts";
import { syncHandler } from "./handler.ts";

export const syncCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  return runWithUserErrorReturn(ctx, () => syncHandler(ctx, effects));
};
