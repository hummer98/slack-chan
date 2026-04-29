import type { CommandHandler } from "../../router.ts";
import { runWithUserErrorReturn } from "../config/index.ts";
import { defaultEffects } from "./effects.ts";
import { statsHandler } from "./handler.ts";

export const statsCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  return runWithUserErrorReturn(ctx, () => statsHandler(ctx, effects));
};
