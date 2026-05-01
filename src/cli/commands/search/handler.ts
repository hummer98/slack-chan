import type { UserRow } from "../../../storage/types.ts";
import { CliError, InternalError, UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { resolveChannelId } from "../read/channel.ts";
import { newResolveUserSentinel, resolveUser } from "../user/resolveUser.ts";
import { parseSearchArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";
import { searchFts } from "./fts.ts";
import { mergeHits } from "./merge.ts";
import { writeSearchOutput } from "./output.ts";
import {
  type RemoteSearchResult,
  searchRemote,
  skippedReasonMessage,
  WARN_PAGINATION_TRUNCATED,
  WARN_XOXB_PREFIX,
} from "./remote.ts";
import { loadToken, resolveWorkspace } from "./workspace.ts";

interface ResolvedChannel {
  channel_id: string;
  channel_name: string | null;
}

/**
 * Compose the Slack `search.messages` query string. plan §6.1 / §6.3.
 *
 *   - `<query>` 内に `"` がある場合は phrase 化を諦め、quote を strip して bare で挿入。
 *   - `--in` 解決済みなら `in:#<name>` (name 解決時) または `in:<id>`。
 *   - `--from` 解決済みなら `from:@<name>` (name 解決時) または `from:<id>`。
 */
export function buildRemoteQuery(
  rawQuery: string,
  channel: ResolvedChannel | null,
  user: UserRow | null,
): string {
  let body: string;
  if (rawQuery.includes('"')) {
    body = rawQuery.replace(/"/g, "");
  } else {
    body = `"${rawQuery}"`;
  }
  let suffix = "";
  if (channel !== null) {
    suffix +=
      typeof channel.channel_name === "string" && channel.channel_name.length > 0
        ? ` in:#${channel.channel_name}`
        : ` in:${channel.channel_id}`;
  }
  if (user !== null) {
    suffix +=
      typeof user.name === "string" && user.name.length > 0
        ? ` from:@${user.name}`
        : ` from:${user.user_id}`;
  }
  return `${body}${suffix}`;
}

export async function searchHandler(ctx: CommandContext, effects: Effects): Promise<number> {
  const args = parseSearchArgv(ctx.rest);

  const team_id = await resolveWorkspace(ctx, effects);

  const cfg = await effects.loadConfig();
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `search: workspace ${team_id} is not registered. Run 'slack-chan config workspace add' first.`,
    );
  }
  const token = await loadToken(team_id, ws.tokens_store, effects);

  const client = effects.createSlackClient(team_id, token);
  const db = effects.openDb();

  // --in / --from を順次解決
  let channelResolved: ResolvedChannel | null = null;
  if (args.in !== null) {
    channelResolved = await resolveChannelId({
      team_id,
      input: args.in,
      client,
      db,
      now: effects.now,
    });
  }
  let userResolved: UserRow | null = null;
  if (args.from !== null) {
    const sentinel = newResolveUserSentinel();
    userResolved = await resolveUser({
      db,
      client,
      team_id,
      identifier: args.from,
      now: effects.now(),
      sentinel,
    });
  }

  // xoxp 以外は事前に skip + warn
  const isUserToken = token.startsWith("xoxp-");
  const useRemote = !args.cachedOnly && isUserToken;
  if (!args.cachedOnly && !isUserToken) {
    ctx.logger.warn(WARN_XOXB_PREFIX);
  }

  // FTS5 + Slack を並列実行 (FTS5 は同期だが Promise.all で形を揃える)
  const ftsPromise: Promise<ReturnType<typeof searchFts>> = Promise.resolve(
    searchFts({
      db,
      team_id,
      query: args.query,
      channel_id: channelResolved?.channel_id ?? null,
      user_id: userResolved?.user_id ?? null,
      limit: args.limit,
    }),
  );
  const remotePromise: Promise<RemoteSearchResult> = useRemote
    ? searchRemote({
        client,
        token,
        logger: ctx.logger,
        count: 100,
        query: buildRemoteQuery(args.query, channelResolved, userResolved),
      })
    : Promise.resolve({ kind: "skipped" as const, reason: "xoxb" as const });

  let ftsHits: ReturnType<typeof searchFts>;
  let remote: RemoteSearchResult;
  try {
    [ftsHits, remote] = await Promise.all([ftsPromise, remotePromise]);
  } catch (e) {
    if (e instanceof CliError) throw e;
    throw new InternalError(
      `search: unexpected error: ${e instanceof Error ? e.message : String(e)}`,
    );
  }

  // skipped / pagination warn
  if (remote.kind === "skipped") {
    if (useRemote) {
      // remote 経路を試行した結果としての skipped (token type / scope) のみ warn する
      ctx.logger.warn(skippedReasonMessage(remote.reason));
    }
    // useRemote=false の場合 (--cached-only or xoxb 事前検出) は既に warn 済 / 不要
  } else if (remote.pagination.page_count > 1) {
    ctx.logger.warn(WARN_PAGINATION_TRUNCATED(remote.pagination.page_count));
  }

  const merged = mergeHits({
    team_id,
    fts: ftsHits,
    remote: remote.kind === "ok" ? remote.hits : [],
    limit: args.limit,
  });
  writeSearchOutput({
    merged,
    format: ctx.format,
    stdout: effects.stdout,
    query: args.query,
    team_id,
    db,
  });

  return EXIT_OK;
}
