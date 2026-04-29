import { setWorkspaces } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { TOKENS_STORES, type TokensStore, type WorkspaceConfig } from "../../../config/types.ts";
import { UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { parseConfigArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";

const USAGE = "Usage: slack-chan config tokens-store <keychain|file>";

export async function tokensStoreHandler(ctx: CommandContext, effects: Effects): Promise<number> {
  const { positionals } = parseConfigArgv(
    ctx.rest,
    {},
    { command: "config tokens-store", usage: USAGE },
  );
  if (positionals.length < 1) {
    throw new UserError(`config tokens-store: missing <keychain|file>.\n${USAGE}`);
  }
  if (positionals.length > 1) {
    throw new UserError(`config tokens-store: too many arguments.\n${USAGE}`);
  }
  const requested = positionals[0] ?? "";
  if (!TOKENS_STORES.includes(requested as TokensStore)) {
    throw new UserError(
      `config tokens-store: kind must be one of ${TOKENS_STORES.join(", ")}.\n${USAGE}`,
    );
  }
  const kind = requested as TokensStore;

  const cfg = await loadConfig({ configDir: effects.configDir, env: effects.env });
  const teamIds = Object.keys(cfg.workspaces);
  if (teamIds.length === 0) {
    ctx.logger.info("no workspaces registered; nothing to migrate.");
    return EXIT_OK;
  }

  // 全 workspace の tokens_store が同じであることを確認（plan §1 #11）
  const currents = new Set<string>();
  for (const t of teamIds) {
    const ws = cfg.workspaces[t];
    if (ws !== undefined) currents.add(ws.tokens_store);
  }
  if (currents.size > 1) {
    throw new UserError(
      `config tokens-store: workspaces have inconsistent tokens_store values (${[...currents].join(", ")}); fix the config TOML manually before migrating.`,
    );
  }
  const current = [...currents][0] as TokensStore;
  if (current === kind) {
    ctx.logger.info(`tokens_store is already '${kind}'; no migration needed.`);
    return EXIT_OK;
  }

  // フェーズ A: 旧 store → 新 store にコピー
  const oldStore = effects.createTokenStore(current);
  const newStore = effects.createTokenStore(kind);
  for (const team_id of teamIds) {
    const token = await oldStore.get(team_id);
    if (token === undefined) {
      ctx.logger.warn(`token for ${team_id} not found in ${current}; skipping copy.`);
      continue;
    }
    await newStore.set(team_id, token);
  }

  // フェーズ B: config を 1 回の atomic write で更新（commit point）
  const updates: Record<string, Partial<WorkspaceConfig>> = {};
  for (const team_id of teamIds) {
    updates[team_id] = { tokens_store: kind };
  }
  await setWorkspaces(updates, { configDir: effects.configDir, env: effects.env });

  // フェーズ C: 旧 store クリーンアップ（best-effort）
  for (const team_id of teamIds) {
    try {
      await oldStore.delete(team_id);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      ctx.logger.warn(`old store cleanup failed for ${team_id}: ${msg}`);
    }
  }

  ctx.logger.info(`tokens_store migrated: ${current} → ${kind} (${teamIds.length} workspace(s))`);
  return EXIT_OK;
}
