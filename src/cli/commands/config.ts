import type { CommandHandler } from "../router.ts";
import { notImplemented, notImplementedNested } from "./_stub.ts";

export const configCmd: CommandHandler = async (ctx) => {
  const sub = ctx.rest[0];
  if (typeof sub === "string" && !sub.startsWith("-")) {
    return notImplementedNested(`config ${sub}`, ctx);
  }
  return notImplemented("config", ctx);
};
