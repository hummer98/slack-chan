import { getDefaultWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { assertAllowedSlackToken } from "../../../secrets/guard.ts";
import { CliError, InternalError, TransientError, UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { type SyncMode, type SyncStats, syncChannelHistory } from "../read/cache.ts";
import { resolveChannelId } from "../read/channel.ts";
import { parseSyncArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";
import type { SyncResult } from "./output.ts";

/**
 * `read.cache` / `read.channel` 由来の `read: ...` プレフィックスを `sync: ...`
 * に書き換える。dm/handler.ts:113-131 の `rebrandError` と同型。Major #1。
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
  if (msg.startsWith("read: ")) return `sync: ${msg.slice("read: ".length)}`;
  return msg;
}

function formatNotInChannelHint(channelLabel: string): string {
  return `sync: not_in_channel — invite the bot to ${channelLabel} via Slack '/invite' or use a user OAuth token.`;
}

export async function syncHandler(ctx: CommandContext, effects: Effects): Promise<number> {
  const args = parseSyncArgv(ctx.rest);

  // 1. workspace 解決（read と同じく env/config TOML fallback）
  const team_id =
    ctx.workspace ??
    (await getDefaultWorkspace({ configDir: effects.configDir, env: effects.env }));
  if (team_id === null || team_id.length === 0) {
    throw new UserError(
      "sync: --workspace=T... is required (no default_workspace set; pass --workspace=T... or run 'slack-chan config workspace set-default').",
    );
  }

  // 2. config / token / SlackClient
  const cfg = await loadConfig({ configDir: effects.configDir, env: effects.env });
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `sync: workspace ${team_id} is not registered. Run 'slack-chan config workspace add' first.`,
    );
  }
  const tokenStore = effects.createTokenStore(ws.tokens_store);
  const token = await tokenStore.get(team_id);
  if (typeof token !== "string" || token.length === 0) {
    throw new UserError(
      `sync: no token stored for ${team_id}. Run 'slack-chan config workspace add' first.`,
    );
  }
  try {
    assertAllowedSlackToken(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(`sync: ${msg}`);
  }

  const client = effects.createSlackClient(team_id, token);
  const db = effects.openDb();

  // 3. channel 解決（resolveChannelId は内部で `read: ...` を throw する可能性があるので
  //    rebrand 経路に通す）
  let channel_id: string;
  let channel_name: string | null;
  try {
    const r = await resolveChannelId({
      team_id,
      input: args.channel,
      client,
      db,
      now: effects.now,
    });
    channel_id = r.channel_id;
    channel_name = r.channel_name;
  } catch (err) {
    throw rebrandError(err);
  }
  const channelLabel = channel_name ?? channel_id;

  // 4. mode 決定 → sync
  const mode: SyncMode = args.full ? "refresh" : "incremental";

  let stats: SyncStats;
  try {
    stats = await syncChannelHistory({
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
    if (err instanceof UserError && err.message.includes("not_in_channel")) {
      throw new UserError(formatNotInChannelHint(channelLabel));
    }
    throw rebrandError(err);
  }

  // 5. JSONL 1 行を stdout に書く（sync は ctx.format 非依存）
  const result: SyncResult = {
    ok: true,
    team_id,
    channel_id,
    channel_name,
    mode,
    upserted: stats.upserted,
    deleted_marked: stats.deletedMarked,
    revived: stats.revived,
    last_synced_ts: stats.lastSyncedTs,
    fetched_at: effects.now(),
  };
  effects.stdout.write(`${JSON.stringify(result)}\n`);
  return EXIT_OK;
}
