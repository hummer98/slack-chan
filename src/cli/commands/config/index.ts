import { UserError } from "../../errors.ts";
import { EXIT_USER_ERROR } from "../../exit-codes.ts";
import type { CommandContext, CommandHandler } from "../../router.ts";
import { channelSetDefaultHandler } from "./channel-set-default.ts";
import { defaultEffects, type Effects } from "./effects.ts";
import { showHandler } from "./show.ts";
import { tokensStoreHandler } from "./tokens-store.ts";
import { workspaceAddHandler } from "./workspace-add.ts";
import { workspaceListHandler } from "./workspace-list.ts";
import { workspaceRemoveHandler } from "./workspace-remove.ts";
import { workspaceSetDefaultHandler } from "./workspace-set-default.ts";

const SECOND_LEVEL = ["workspace", "channel", "tokens-store", "show"] as const;
type SecondLevel = (typeof SECOND_LEVEL)[number];

/**
 * Catch a `UserError` thrown by a handler's input validation and convert it
 * into `logger.error(message) + return EXIT_USER_ERROR`. This keeps the
 * dispatcher / handler surface returning numbers (router.ts does NOT catch
 * `UserError`), while letting handlers continue to use `throw new UserError(...)`
 * for early-return paths. Plan §3.1 / Decision Log §13.4 (resolved variant a).
 */
export async function runWithUserErrorReturn(
  ctx: CommandContext,
  fn: () => Promise<number>,
): Promise<number> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof UserError) {
      ctx.logger.error(e.message);
      return EXIT_USER_ERROR;
    }
    throw e;
  }
}

export const configCmd: CommandHandler = async (ctx) => {
  const effects = defaultEffects(process.env);
  return dispatchConfig(ctx, effects);
};

/**
 * Internal dispatcher that takes a pre-built `Effects`. Exported for tests
 * that want to inject the DI hatch without spinning up `defaultEffects()`.
 */
export async function dispatchConfig(ctx: CommandContext, effects: Effects): Promise<number> {
  const sub = ctx.rest[0];
  if (sub === undefined) {
    ctx.logger.error("Usage: slack-chan config <workspace|channel|tokens-store|show> ...");
    return EXIT_USER_ERROR;
  }
  if (!SECOND_LEVEL.includes(sub as SecondLevel)) {
    ctx.logger.error(`Unknown 'config' subcommand: ${sub}`);
    return EXIT_USER_ERROR;
  }
  const child: CommandContext = { ...ctx, rest: ctx.rest.slice(1) };
  switch (sub as SecondLevel) {
    case "show":
      return runWithUserErrorReturn(child, () => showHandler(child, effects));
    case "tokens-store":
      return runWithUserErrorReturn(child, () => tokensStoreHandler(child, effects));
    case "workspace":
      return dispatchWorkspace(child, effects);
    case "channel":
      return dispatchChannel(child, effects);
  }
}

async function dispatchWorkspace(ctx: CommandContext, effects: Effects): Promise<number> {
  const action = ctx.rest[0];
  const child: CommandContext = { ...ctx, rest: ctx.rest.slice(1) };
  switch (action) {
    case "add":
      return runWithUserErrorReturn(child, () => workspaceAddHandler(child, effects));
    case "list":
      return runWithUserErrorReturn(child, () => workspaceListHandler(child, effects));
    case "remove":
      return runWithUserErrorReturn(child, () => workspaceRemoveHandler(child, effects));
    case "set-default":
      return runWithUserErrorReturn(child, () => workspaceSetDefaultHandler(child, effects));
    default:
      ctx.logger.error("Usage: slack-chan config workspace <add|list|remove|set-default> ...");
      return EXIT_USER_ERROR;
  }
}

async function dispatchChannel(ctx: CommandContext, effects: Effects): Promise<number> {
  const action = ctx.rest[0];
  const child: CommandContext = { ...ctx, rest: ctx.rest.slice(1) };
  if (action !== "set-default") {
    ctx.logger.error("Usage: slack-chan config channel set-default <ws> <id_or_name>");
    return EXIT_USER_ERROR;
  }
  return runWithUserErrorReturn(child, () => channelSetDefaultHandler(child, effects));
}
