import type { CommandHandler } from "../../router.ts";
import { runWithUserErrorReturn } from "../config/index.ts";
import { defaultEffects } from "./effects.ts";
import { readHandler } from "./handler.ts";

export const readCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  return runWithUserErrorReturn(ctx, () => readHandler(ctx, effects));
};
