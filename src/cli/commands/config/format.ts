import type { OutputFormat } from "../../../config/types.ts";
import { isColorEnabled, makeColors } from "../../../output/ansi.ts";
import { selectFormatter } from "../../../output/format.ts";
import { formatTable } from "../../../output/human/index.ts";

export interface ConfigShowEnvOverride {
  source: "env";
  env: string;
}

export interface ConfigShowWorkspaceRecord {
  team_id: string;
  name: string;
  default_channel: string | null;
  tokens_store: string;
}

export interface ConfigShowRecord {
  default_workspace: string | null;
  default_workspace_override?: ConfigShowEnvOverride;
  default_channel_override?: ConfigShowEnvOverride;
  output_format_override?: ConfigShowEnvOverride;
  workspaces: ConfigShowWorkspaceRecord[];
  output: { format: string; cache_window_days: number };
}

export interface WorkspaceListRecord {
  team_id: string;
  name: string;
  default_channel: string | null;
  tokens_store: string;
  /** Redacted (`xoxb-***xxxx`) form, or `null` when no token is stored. */
  token: string | null;
}

interface RenderHumanOpts {
  isTTY?: boolean;
}

/**
 * Render `config show` for the given format. Human mode adds suffixes like
 * `(env: SLACK_CHAN_DEFAULT_WORKSPACE)` after each overridden value;
 * jsonl/toon modes carry the override as a sibling `*_override` field so
 * downstream tooling can detect the env source structurally.
 */
export function renderConfigShow(
  record: ConfigShowRecord,
  format: OutputFormat,
  opts: RenderHumanOpts = {},
): string {
  if (format !== "human") {
    const f = selectFormatter(format);
    return f.format(record);
  }
  return renderConfigShowHuman(record, opts);
}

function renderConfigShowHuman(record: ConfigShowRecord, opts: RenderHumanOpts): string {
  const colors = makeColors(opts.isTTY === undefined ? isColorEnabled() : opts.isTTY);
  const lines: string[] = [];
  const dwSuffix = record.default_workspace_override
    ? ` ${colors.dim(`(env: ${record.default_workspace_override.env})`)}`
    : "";
  lines.push(
    `${colors.bold("default_workspace")} = ${record.default_workspace ?? "(none)"}${dwSuffix}`,
  );
  if (record.default_channel_override) {
    lines.push(
      `${colors.bold("default_channel")}   ${colors.dim(`(env: ${record.default_channel_override.env})`)}`,
    );
  }
  const ofSuffix = record.output_format_override
    ? ` ${colors.dim(`(env: ${record.output_format_override.env})`)}`
    : "";
  lines.push(`${colors.bold("output.format")}     = ${record.output.format}${ofSuffix}`);
  lines.push(`${colors.bold("output.cache_window_days")} = ${record.output.cache_window_days}`);
  lines.push("");
  if (record.workspaces.length === 0) {
    lines.push(colors.dim("workspaces: (empty)"));
  } else {
    lines.push(colors.bold("workspaces:"));
    for (const ws of record.workspaces) {
      lines.push(`  - ${ws.team_id} (${ws.name})`);
      lines.push(`      default_channel = ${ws.default_channel ?? "(none)"}`);
      lines.push(`      tokens_store    = ${ws.tokens_store}`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/**
 * Render `config workspace list`. Each row is emitted independently in
 * jsonl/toon; human mode produces an aligned ASCII table.
 */
export function renderWorkspaceList(
  rows: readonly WorkspaceListRecord[],
  format: OutputFormat,
  opts: RenderHumanOpts = {},
): string {
  if (format !== "human") {
    const f = selectFormatter(format);
    return rows.map((r) => f.format(r)).join("");
  }
  return renderWorkspaceListHuman(rows, opts);
}

function renderWorkspaceListHuman(
  rows: readonly WorkspaceListRecord[],
  opts: RenderHumanOpts,
): string {
  const colors = makeColors(opts.isTTY === undefined ? isColorEnabled() : opts.isTTY);
  if (rows.length === 0) {
    return `${colors.dim("(no workspaces registered)")}\n`;
  }
  const headers = ["TEAM_ID", "NAME", "DEFAULT_CHANNEL", "TOKENS_STORE", "TOKEN"];
  const tableRows = rows.map((r) => [
    r.team_id,
    r.name,
    r.default_channel ?? "(none)",
    r.tokens_store,
    r.token ?? "(not stored)",
  ]);
  return formatTable(headers, tableRows, colors);
}
