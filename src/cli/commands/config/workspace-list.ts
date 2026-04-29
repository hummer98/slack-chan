import { loadConfig } from "../../../config/io.ts";
import { redactToken } from "../../../secrets/redact.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import type { Effects } from "./effects.ts";
import { renderWorkspaceList, type WorkspaceListRecord } from "./format.ts";

/**
 * `config workspace list` — enumerate registered workspaces. Each row joins:
 *
 * - `[workspace.<team_id>]` from config (name / default_channel / tokens_store)
 * - the matching token from `TokenStore.get(team_id)`, redacted via
 *   `redactToken` so logs stay safe. When the token is absent the row's
 *   `token` is `null` rather than `***`, so callers can spot half-installed
 *   workspaces.
 *
 * No DB read is required for this command — config TOML is the SSOT.
 */
export async function workspaceListHandler(ctx: CommandContext, effects: Effects): Promise<number> {
  const cfg = await loadConfig({ configDir: effects.configDir, env: effects.env });
  const teamIds = Object.keys(cfg.workspaces);
  if (teamIds.length === 0) {
    process.stdout.write(renderWorkspaceList([], ctx.format));
    return EXIT_OK;
  }

  // Group team_ids by tokens_store so we only build each backend once.
  const byKind = new Map<string, string[]>();
  for (const team_id of teamIds) {
    const ws = cfg.workspaces[team_id];
    if (ws === undefined) continue;
    const list = byKind.get(ws.tokens_store) ?? [];
    list.push(team_id);
    byKind.set(ws.tokens_store, list);
  }

  const tokenByTeam = new Map<string, string | null>();
  for (const [kind, ids] of byKind) {
    const store = effects.createTokenStore(kind as "keychain" | "file");
    for (const team_id of ids) {
      try {
        const tok = await store.get(team_id);
        tokenByTeam.set(team_id, tok ?? null);
      } catch {
        tokenByTeam.set(team_id, null);
      }
    }
  }

  const rows: WorkspaceListRecord[] = teamIds.map((team_id) => {
    const ws = cfg.workspaces[team_id];
    const tok = tokenByTeam.get(team_id);
    return {
      team_id,
      name: ws?.name ?? "",
      default_channel: ws?.default_channel ?? null,
      tokens_store: ws?.tokens_store ?? "file",
      token: tok ? redactToken(tok) : null,
    };
  });

  process.stdout.write(renderWorkspaceList(rows, ctx.format));
  return EXIT_OK;
}
