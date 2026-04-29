import { assertAllowedSlackToken } from "../../../secrets/guard.ts";
import { CliError, InternalError, TransientError, UserError } from "../../errors.ts";
import type { CommandContext } from "../../router.ts";
import { handlePost } from "../post/handler.ts";
import { readHandler } from "../read/handler.ts";
import { type DmArgs, parseDmArgv } from "./argv.ts";
import { type Effects, toPostEffects, toReadEffects } from "./effects.ts";
import { openImChannel } from "./im.ts";
import { resolveUserId } from "./users.ts";

/**
 * `slack-chan dm` 主入口。
 *
 *   1. argv parse → user 形式判別
 *   2. workspace / token 解決（post と同じパターン）
 *   3. user → user_id → IM channel id (Dxxx)
 *   4. mode = post → post handler に `[Dxxx, text, ...flags]` で再委譲
 *      mode = read → read handler に `[Dxxx, ...flags]` で再委譲
 *
 * post / read から伝播した `UserError` / `TransientError` / `InternalError` は
 * メッセージプレフィックスを `dm: ` に書き換えて rethrow する（plan §5.1, §7.4）。
 */
export async function handleDm(ctx: CommandContext, effects: Effects): Promise<number> {
  const args: DmArgs = parseDmArgv(ctx.rest);

  // 1. workspace 解決
  const team_id = ctx.workspace ?? (await effects.getDefaultWorkspace());
  if (team_id === null || team_id.length === 0) {
    throw new UserError(
      "dm: --workspace=T... is required (no default_workspace set; pass --workspace=T... or run 'slack-chan config workspace set-default').",
    );
  }

  // 2. config / token / SlackClient
  const cfg = await effects.loadConfig();
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `dm: workspace ${team_id} is not registered. Run 'slack-chan config workspace add' first.`,
    );
  }
  let tokenStore: ReturnType<Effects["createTokenStore"]>;
  try {
    tokenStore = effects.createTokenStore(ws.tokens_store);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(
      `dm: cannot use ${ws.tokens_store} token backend on this platform (${msg}). ` +
        "Run `slack-chan config tokens-store file` to switch.",
    );
  }
  const token = await tokenStore.get(team_id);
  if (typeof token !== "string" || token.length === 0) {
    throw new UserError(
      `dm: no token stored for ${team_id}. Run 'slack-chan config workspace add' first.`,
    );
  }
  try {
    assertAllowedSlackToken(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(`dm: ${msg}`);
  }

  const slackClient = effects.createSlackClient(team_id, token);

  // 3. user → user_id → Dxxx
  const user_id = await resolveUserId({
    user: args.user,
    userKind: args.userKind,
    token,
    client: slackClient,
  });
  const channel_id = await openImChannel({ user_id, client: slackClient });

  // 4. mode 別に既存 handler に再委譲。argv の <user> を <channel_id> に
  //    置換し、それ以外のフラグはそのまま渡す（dm 自身は中身を解釈しない）。
  const adaptedRest = adaptRest(args, channel_id);
  const adaptedCtx: CommandContext = { ...ctx, rest: adaptedRest };

  try {
    if (args.mode === "post") {
      return await handlePost(adaptedCtx, toPostEffects(effects));
    }
    return await readHandler(adaptedCtx, toReadEffects(effects));
  } catch (e) {
    throw rebrandError(e);
  }
}

function adaptRest(args: DmArgs, channel_id: string): string[] {
  if (args.mode === "post") {
    const out: string[] = [channel_id, args.text];
    if (args.thread !== undefined) out.push(`--thread=${args.thread}`);
    if (args.file !== undefined) out.push(`--file=${args.file}`);
    if (args.blocks !== undefined) out.push(`--blocks=${args.blocks}`);
    return out;
  }
  const out: string[] = [channel_id];
  if (args.limit !== undefined) out.push(`--limit=${args.limit}`);
  if (args.since !== undefined) out.push(`--since=${args.since}`);
  if (args.thread !== undefined) out.push(`--thread=${args.thread}`);
  if (args.refresh) out.push("--refresh");
  if (args.fullEditScan) out.push("--full-edit-scan");
  return out;
}

/**
 * post / read handler の throw する CliError は `post: ...` / `read: ...` の
 * プレフィックス付き。dm の出力に揃えるため `dm: ...` に置換する。それ以外
 * (例: 内部 throw した dm: 〜) はそのまま流す。
 */
function rebrandError(e: unknown): unknown {
  if (e instanceof UserError) {
    return new UserError(replacePrefix(e.message));
  }
  if (e instanceof TransientError) {
    return new TransientError(replacePrefix(e.message));
  }
  if (e instanceof InternalError) {
    return new InternalError(replacePrefix(e.message));
  }
  if (e instanceof CliError) return e;
  return e;
}

function replacePrefix(msg: string): string {
  if (msg.startsWith("post: ")) return `dm: ${msg.slice("post: ".length)}`;
  if (msg.startsWith("read: ")) return `dm: ${msg.slice("read: ".length)}`;
  return msg;
}
