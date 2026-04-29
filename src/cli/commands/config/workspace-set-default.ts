import { setDefaultWorkspace } from "../../../config/api.ts";
import { UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { parseConfigArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";

const USAGE = "Usage: slack-chan config workspace set-default <team_id>";

export async function workspaceSetDefaultHandler(
  ctx: CommandContext,
  effects: Effects,
): Promise<number> {
  const { positionals } = parseConfigArgv(
    ctx.rest,
    {},
    { command: "config workspace set-default", usage: USAGE },
  );
  if (positionals.length < 1) {
    throw new UserError(`config workspace set-default: missing <team_id>.\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new UserError(`config workspace set-default: too many arguments.\n${USAGE}`);
  }
  const team_id = positionals[0] ?? "";
  try {
    await setDefaultWorkspace(team_id, { configDir: effects.configDir, env: effects.env });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new UserError(`config workspace set-default: ${msg}`);
  }
  ctx.logger.info(`default_workspace = ${team_id}`);
  return EXIT_OK;
}
