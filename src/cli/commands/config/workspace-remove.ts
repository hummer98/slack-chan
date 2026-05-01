import { removeWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import * as channelsDao from "../../../storage/dao/channels.ts";
import * as filesDao from "../../../storage/dao/files.ts";
import * as messagesDao from "../../../storage/dao/messages.ts";
import * as usersDao from "../../../storage/dao/users.ts";
import * as workspacesDao from "../../../storage/dao/workspaces.ts";
import { UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { parseConfigArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";
import { promptYesNo } from "./prompt.ts";

const USAGE = "Usage: slack-chan config workspace remove <team_id> [--yes]";

type RemoveArgs = {
  yes?: boolean;
} & Record<string, unknown>;

export async function workspaceRemoveHandler(
  ctx: CommandContext,
  effects: Effects,
): Promise<number> {
  const { values, positionals } = parseConfigArgv<RemoveArgs>(
    ctx.rest,
    { yes: { type: "boolean" } },
    { command: "config workspace remove", usage: USAGE },
  );
  if (positionals.length < 1) {
    throw new UserError(`config workspace remove: missing <team_id>.\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new UserError(`config workspace remove: too many arguments.\n${USAGE}`);
  }
  const team_id = positionals[0] ?? "";

  const ok = await promptYesNo({
    question: `Remove workspace ${team_id}? This deletes all cached messages, channels, users, and files for this team.`,
    yes: values.yes === true,
    isTTY: effects.isTTY(),
  });
  if (!ok) {
    ctx.logger.info("aborted");
    return EXIT_OK;
  }

  // 1. config を先に読んで token store kind を覚えておく（後の TokenStore.delete 用）
  const cfg = await loadConfig({ configDir: effects.configDir, env: effects.env });
  const ws = cfg.workspaces[team_id];
  if (ws === undefined) {
    ctx.logger.warn(`workspace ${team_id} is not registered; nothing to do.`);
    return EXIT_OK;
  }

  // 2. DB tx を最初に。tx 失敗 → ここで throw、config / TokenStore は無傷で復旧可能。
  const db = effects.openDb();
  db.transaction(() => {
    filesDao.deleteByTeam(db, team_id);
    messagesDao.deleteByTeam(db, team_id);
    usersDao.deleteByTeam(db, team_id);
    channelsDao.deleteByTeam(db, team_id);
    workspacesDao.deleteByTeam(db, team_id);
  })();

  // 3. config TOML を消す（default_workspace の null 化は removeWorkspace 内で対応）
  await removeWorkspace(team_id, { configDir: effects.configDir, env: effects.env });

  // 4. 最後に TokenStore.delete を best-effort。失敗してもゾンビ token のみ残る。
  try {
    const store = effects.createTokenStore(ws.tokens_store);
    await store.delete(team_id);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    ctx.logger.warn(
      `token cleanup failed for ${team_id}: ${msg} (zombie token can be removed manually)`,
    );
  }

  ctx.logger.info(`workspace removed: ${team_id}`);
  return EXIT_OK;
}
