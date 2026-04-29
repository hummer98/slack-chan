import {
  ENV_DEFAULT_CHANNEL,
  ENV_DEFAULT_WORKSPACE,
  ENV_OUTPUT_FORMAT,
} from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import type { Effects } from "./effects.ts";
import { type ConfigShowEnvOverride, type ConfigShowRecord, renderConfigShow } from "./format.ts";

function envOverride(env: NodeJS.ProcessEnv, key: string): ConfigShowEnvOverride | undefined {
  const v = env[key];
  if (typeof v !== "string" || v.trim().length === 0) return undefined;
  return { source: "env", env: key };
}

export async function showHandler(ctx: CommandContext, effects: Effects): Promise<number> {
  const cfg = await loadConfig({ configDir: effects.configDir, env: effects.env });
  const dwOverride = envOverride(effects.env, ENV_DEFAULT_WORKSPACE);
  const dcOverride = envOverride(effects.env, ENV_DEFAULT_CHANNEL);
  const ofOverride = envOverride(effects.env, ENV_OUTPUT_FORMAT);

  const record: ConfigShowRecord = {
    default_workspace: cfg.default_workspace,
    workspaces: Object.entries(cfg.workspaces).map(([team_id, ws]) => ({
      team_id,
      name: ws.name,
      default_channel: ws.default_channel,
      tokens_store: ws.tokens_store,
    })),
    output: {
      format: cfg.output.format,
      cache_window_days: cfg.output.cache_window_days,
    },
  };
  if (dwOverride) record.default_workspace_override = dwOverride;
  if (dcOverride) record.default_channel_override = dcOverride;
  if (ofOverride) record.output_format_override = ofOverride;

  process.stdout.write(renderConfigShow(record, ctx.format));
  return EXIT_OK;
}
