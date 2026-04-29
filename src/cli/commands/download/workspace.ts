import type { TokensStore } from "../../../config/types.ts";
import { assertAllowedSlackToken } from "../../../secrets/guard.ts";
import { assertValidTeamId } from "../../../secrets/index-file.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { UserError } from "../../errors.ts";
import type { CommandContext } from "../../router.ts";
import type { Effects } from "./effects.ts";

/**
 * Resolve the target `team_id` for this `download` invocation.
 *
 *   1. `--workspace=<id>` (after format check).
 *   2. `effects.getDefaultWorkspace()` (env > config TOML).
 *
 * Mirrors `commands/post/workspace.ts` — keep the two in sync until a
 * `_shared/` extraction is split into its own task.
 */
export async function resolveWorkspace(ctx: CommandContext, effects: Effects): Promise<string> {
  if (ctx.workspace !== null && ctx.workspace.length > 0) {
    try {
      assertValidTeamId(ctx.workspace);
    } catch {
      throw new UserError(
        `download: --workspace must match /^T[A-Z0-9]{1,32}$/, got '${ctx.workspace}'.`,
      );
    }
    return ctx.workspace;
  }
  const def = await effects.getDefaultWorkspace();
  if (def === null) {
    throw new UserError(
      "download: no --workspace specified and no default_workspace is configured. " +
        "Set SLACK_CHAN_DEFAULT_WORKSPACE or run `slack-chan config workspace set-default <team_id>`.",
    );
  }
  return def;
}

/**
 * Load the access token for `team_id`. Mirrors `commands/post/workspace.ts`
 * — keep both in sync until shared.
 */
export async function loadToken(
  team_id: string,
  kind: TokensStore,
  effects: Effects,
): Promise<string> {
  let store: TokenStore;
  try {
    store = effects.createTokenStore(kind);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(
      `download: cannot use ${kind} token backend on this platform (${msg}). ` +
        "Run `slack-chan config tokens-store file` to switch.",
    );
  }
  const token = await store.get(team_id);
  if (token === undefined) {
    throw new UserError(
      `download: no token stored for ${team_id} in ${kind} backend. ` +
        `Run \`slack-chan config workspace add --token=<xoxp|xoxb> --tokens-store=${kind}\`.`,
    );
  }
  try {
    assertAllowedSlackToken(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(`download: stored token violates AUP (${msg}).`);
  }
  return token;
}
