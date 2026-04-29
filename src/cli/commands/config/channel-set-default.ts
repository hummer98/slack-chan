import { setWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import * as workspacesDao from "../../../storage/dao/workspaces.ts";
import { TransientError, UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { parseConfigArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";

const USAGE = "Usage: slack-chan config channel set-default <ws> <id_or_name>";
const CHANNEL_ID_RE = /^[CGDM][A-Z0-9]{1,32}$/;

interface Channel {
  id?: string;
  name?: string;
  name_normalized?: string;
}

interface ConversationsListResponse {
  ok?: boolean;
  channels?: Channel[];
  error?: string;
}

function looksLikeChannelId(s: string): boolean {
  return CHANNEL_ID_RE.test(s);
}

function stripHash(s: string): string {
  return s.startsWith("#") ? s.slice(1) : s;
}

export async function channelSetDefaultHandler(
  ctx: CommandContext,
  effects: Effects,
): Promise<number> {
  const { positionals } = parseConfigArgv(
    ctx.rest,
    {},
    { command: "config channel set-default", usage: USAGE },
  );
  if (positionals.length < 2) {
    throw new UserError(
      `config channel set-default: <ws> and <id_or_name> are both required.\n${USAGE}`,
    );
  }
  if (positionals.length > 2) {
    throw new UserError(`config channel set-default: too many arguments.\n${USAGE}`);
  }
  const team_id = positionals[0] ?? "";
  const idOrName = positionals[1] ?? "";

  const cfg = await loadConfig({ configDir: effects.configDir, env: effects.env });
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    throw new UserError(
      `config channel set-default: workspace ${team_id} is not registered.\n${USAGE}`,
    );
  }

  let channelId: string;
  if (looksLikeChannelId(idOrName)) {
    channelId = idOrName;
  } else {
    const name = stripHash(idOrName);
    const store = effects.createTokenStore(ws.tokens_store);
    const token = await store.get(team_id);
    if (typeof token !== "string" || token.length === 0) {
      throw new UserError(
        `config channel set-default: no token stored for ${team_id}. Run \`config workspace add\` first.`,
      );
    }
    const client = effects.createSlackClient(team_id, token);
    let res: ConversationsListResponse;
    try {
      res = (await client.conversationsList({
        types: "public_channel,private_channel",
        limit: 1000,
      })) as ConversationsListResponse;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new TransientError(`config channel set-default: conversations.list failed: ${msg}`);
    }
    if (res.ok !== true) {
      throw new TransientError(
        `config channel set-default: conversations.list returned not-ok (${res.error ?? "unknown"})`,
      );
    }
    const match = (res.channels ?? []).find((c) => c.name === name || c.name_normalized === name);
    if (match?.id === undefined) {
      throw new UserError(
        `config channel set-default: Channel '${name}' not found in ${team_id}. Try the channel ID (Cxxxx) directly, or check --workspace.\n${USAGE}`,
      );
    }
    channelId = match.id;
  }

  // 1. config TOML に setWorkspace で patch
  await setWorkspace(
    team_id,
    { default_channel: channelId },
    { configDir: effects.configDir, env: effects.env },
  );

  // 2. workspaces テーブルにも反映（副本）
  const db = effects.openDb();
  workspacesDao.setDefault(db, team_id, channelId);

  ctx.logger.info(`default_channel for ${team_id} = ${channelId}`);
  return EXIT_OK;
}
