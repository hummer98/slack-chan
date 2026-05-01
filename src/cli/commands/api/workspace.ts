import type { TokensStore } from "../../../config/types.ts";
import { assertAllowedSlackToken } from "../../../secrets/guard.ts";
import { assertValidTeamId } from "../../../secrets/index-file.ts";
import type { TokenStore } from "../../../secrets/store.ts";
import { UserError } from "../../errors.ts";
import type { CommandContext } from "../../router.ts";
import type { Effects } from "./effects.ts";

/**
 * Resolve the target `team_id` for this `api` invocation.
 *
 * Unlike `post` / `read` / `user`, `api` does **not** fall back to
 * `default_workspace`: the escape hatch can write to any workspace, and
 * silently picking a default would let `slack-chan api chat.delete ...`
 * hit the wrong team. `--workspace=<id>` must be passed explicitly.
 */
export async function resolveWorkspace(ctx: CommandContext, _effects: Effects): Promise<string> {
  if (ctx.workspace === null || ctx.workspace.length === 0) {
    throw new UserError(
      "api: --workspace=<id> is required (no default fallback to prevent accidental " +
        "writes to the wrong workspace). Pass --workspace=<team_id> explicitly.",
    );
  }
  try {
    assertValidTeamId(ctx.workspace);
  } catch {
    throw new UserError(`api: --workspace must match /^T[A-Z0-9]{1,32}$/, got '${ctx.workspace}'.`);
  }
  return ctx.workspace;
}

/**
 * Load the access token for `team_id` from the configured backend.
 * Same shape as `post/workspace.ts::loadToken` — the prefix is `api:` so
 * users see which command failed.
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
      `api: cannot use ${kind} token backend on this platform (${msg}). ` +
        "Run `slack-chan config tokens-store file` to switch.",
    );
  }
  const token = await store.get(team_id);
  if (token === undefined) {
    throw new UserError(
      `api: no token stored for ${team_id} in ${kind} backend. ` +
        `Run \`slack-chan config workspace add --token=<xoxp|xoxb> --tokens-store=${kind}\`.`,
    );
  }
  try {
    assertAllowedSlackToken(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(`api: stored token violates AUP (${msg}).`);
  }
  return token;
}
