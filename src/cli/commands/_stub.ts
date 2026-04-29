import { EXIT_USER_ERROR } from "../exit-codes.ts";
import type { CommandContext } from "../router.ts";

export function notImplemented(name: string, ctx: CommandContext): number {
  ctx.logger.error(`"${name}" is not implemented yet (T010+).`);
  return EXIT_USER_ERROR;
}

export function notImplementedNested(label: string, ctx: CommandContext): number {
  ctx.logger.error(`"${label}" is not implemented yet (T010+).`);
  return EXIT_USER_ERROR;
}
