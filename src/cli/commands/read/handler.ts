import { getDefaultWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { assertAllowedSlackToken } from "../../../secrets/guard.ts";
import { UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { parseReadArgv, type ReadArgs } from "./argv.ts";
import { type SyncMode, syncChannelHistory } from "./cache.ts";
import { resolveChannelId } from "./channel.ts";
import type { Effects } from "./effects.ts";
import { writeChannelOutput, writeThreadOutput } from "./output.ts";
import { syncThreadReplies } from "./thread.ts";

function formatNotInChannelHint(channelLabel: string): string {
  return `read: not_in_channel — invite the bot to ${channelLabel} via Slack '/invite' or use a user OAuth token.`;
}

/**
 * `not_in_channel` だけは bot OAuth / user OAuth 両ケースの解決手段を hint
 * 文字列で返す（M5 / plan §11.2）。それ以外の Slack エラーは syncChannelHistory
 * / syncThreadReplies / resolveChannelId 内で UserError or TransientError に
 * dispatch される。
 */
function rethrowWithChannelHint(err: unknown, channelLabel: string): never {
  if (err instanceof UserError && err.message.includes("not_in_channel")) {
    throw new UserError(formatNotInChannelHint(channelLabel));
  }
  throw err;
}

function decideMode(args: ReadArgs, ctx: CommandContext): SyncMode {
  if (args.refresh) {
    if (args.fullEditScan) {
      ctx.logger.warn("--refresh implies --full-edit-scan; ignoring --full-edit-scan");
    }
    return "refresh";
  }
  if (args.fullEditScan) return "full-edit-scan";
  return "incremental";
}

export async function readHandler(ctx: CommandContext, effects: Effects): Promise<number> {
  const args = parseReadArgv(ctx.rest);

  // 1. workspace 解決（env → config TOML の順）
  const team_id =
    ctx.workspace ??
    (await getDefaultWorkspace({ configDir: effects.configDir, env: effects.env }));
  if (team_id === null || team_id.length === 0) {
    throw new UserError(
      "read: --workspace=T... is required (no default_workspace set; pass --workspace=T... or run 'slack-chan config workspace set-default').",
    );
  }

  // 2. config / token / SlackClient
  const cfg = await loadConfig({ configDir: effects.configDir, env: effects.env });
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `read: workspace ${team_id} is not registered. Run 'slack-chan config workspace add' first.`,
    );
  }
  const tokenStore = effects.createTokenStore(ws.tokens_store);
  const token = await tokenStore.get(team_id);
  if (typeof token !== "string" || token.length === 0) {
    throw new UserError(
      `read: no token stored for ${team_id}. Run 'slack-chan config workspace add' first.`,
    );
  }
  try {
    assertAllowedSlackToken(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(`read: ${msg}`);
  }

  const client = effects.createSlackClient(team_id, token);
  const db = effects.openDb();

  // 3. channel 解決
  const { channel_id, channel_name } = await resolveChannelId({
    team_id,
    input: args.channel,
    client,
    db,
    now: effects.now,
  });
  const channelLabel = channel_name ?? channel_id;

  // 4. mode 決定 → sync → output
  if (args.thread !== null) {
    try {
      await syncThreadReplies({
        team_id,
        channel_id,
        thread_ts: args.thread,
        client,
        db,
        now: effects.now,
        logger: ctx.logger,
      });
    } catch (err) {
      rethrowWithChannelHint(err, channelLabel);
    }
    writeThreadOutput({
      team_id,
      channel_id,
      thread_ts: args.thread,
      db,
      args,
      format: ctx.format,
      stdout: effects.stdout,
      now: effects.now,
    });
  } else {
    const mode = decideMode(args, ctx);
    try {
      await syncChannelHistory({
        team_id,
        channel_id,
        mode,
        cache_window_days: cfg.output.cache_window_days,
        client,
        db,
        now: effects.now,
        logger: ctx.logger,
      });
    } catch (err) {
      rethrowWithChannelHint(err, channelLabel);
    }
    writeChannelOutput({
      team_id,
      channel_id,
      db,
      args,
      format: ctx.format,
      stdout: effects.stdout,
      now: effects.now,
    });
  }

  return EXIT_OK;
}
