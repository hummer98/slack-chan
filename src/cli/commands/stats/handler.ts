import { selectFormatter } from "../../../output/format.ts";
import { assertValidTeamId } from "../../../secrets/index-file.ts";
import * as workspacesDao from "../../../storage/dao/workspaces.ts";
import type { WorkspaceRow } from "../../../storage/types.ts";
import { UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { aggregateWorkspace } from "./aggregate.ts";
import { parseStatsArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";

export async function statsHandler(ctx: CommandContext, effects: Effects): Promise<number> {
  parseStatsArgv(ctx.rest);
  const db = effects.openDb();
  const dbBytes = effects.dbPath === ":memory:" ? 0 : effects.statBytes(effects.dbPath);

  let targets: WorkspaceRow[];
  if (ctx.workspace !== null && ctx.workspace.length > 0) {
    try {
      assertValidTeamId(ctx.workspace);
    } catch {
      throw new UserError(
        `stats: --workspace must match /^T[A-Z0-9]{1,32}$/, got '${ctx.workspace}'.`,
      );
    }
    const ws = workspacesDao.get(db, ctx.workspace);
    if (ws === null) {
      throw new UserError(
        `stats: workspace ${ctx.workspace} is not registered. Run 'slack-chan config workspace add' first.`,
      );
    }
    targets = [ws];
  } else {
    targets = workspacesDao.list(db);
  }

  const f = selectFormatter(ctx.format);
  for (const ws of targets) {
    const rec = aggregateWorkspace(db, ws, dbBytes);
    effects.stdout.write(f.format(rec));
  }
  return EXIT_OK;
}
