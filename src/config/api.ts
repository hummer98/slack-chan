import { assertValidTeamId } from "../secrets/index-file.ts";
import { loadConfig, saveConfig } from "./io.ts";
import type { ConfigPathOptions } from "./path.ts";
import { assertPartialWorkspaceConfig } from "./schema.ts";
import {
  type Config,
  OUTPUT_FORMATS,
  type OutputFormat,
  TOKENS_STORES,
  type WorkspaceConfig,
} from "./types.ts";

export type ApiOptions = ConfigPathOptions;

export const ENV_DEFAULT_WORKSPACE = "SLACK_CHAN_DEFAULT_WORKSPACE";
export const ENV_DEFAULT_CHANNEL = "SLACK_CHAN_DEFAULT_CHANNEL";
export const ENV_OUTPUT_FORMAT = "SLACK_CHAN_OUTPUT_FORMAT";

/**
 * Reject C0 control characters (0x00..0x1F) and DEL (0x7F) in env values
 * that flow into Slack API calls. Implemented as a charCode scan rather
 * than a regex literal so the source file stays printable ASCII.
 */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

function readEnv(opts: ApiOptions, key: string): string | undefined {
  const env = opts.env ?? process.env;
  const v = env[key];
  if (typeof v !== "string") return undefined;
  const trimmed = v.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

/**
 * Resolve the default workspace `team_id`, honouring env > config.
 *
 * - `SLACK_CHAN_DEFAULT_WORKSPACE` (when non-empty) wins. The value must
 *   match the team_id format; non-conforming env values throw early so a
 *   typo does not silently re-route writes.
 * - Otherwise `config.default_workspace`, or `null` if neither is set.
 *
 * The env value is intentionally never written back to disk by any other
 * API in this module (see `setWorkspace` / `removeWorkspace`).
 */
export async function getDefaultWorkspace(opts: ApiOptions = {}): Promise<string | null> {
  const envVal = readEnv(opts, ENV_DEFAULT_WORKSPACE);
  if (envVal !== undefined) {
    try {
      assertValidTeamId(envVal);
    } catch {
      throw new Error(`${ENV_DEFAULT_WORKSPACE} must match /^T[A-Z0-9]{1,32}$/.`);
    }
    return envVal;
  }
  const cfg = await loadConfig(opts);
  return cfg.default_workspace;
}

/**
 * Resolve the default channel for a workspace, honouring env > config.
 *
 * The env override is workspace-agnostic: when `SLACK_CHAN_DEFAULT_CHANNEL`
 * is set, the same value is returned regardless of `team_id`. Strict format
 * validation (`#name` vs `Cxxx`) is left to the read-side T008; this layer
 * only rejects obviously broken values (control characters / empty after
 * trim) so a stray newline cannot make it as far as the Slack API call.
 */
export async function getDefaultChannel(
  team_id: string,
  opts: ApiOptions = {},
): Promise<string | null> {
  assertValidTeamId(team_id);
  const envVal = readEnv(opts, ENV_DEFAULT_CHANNEL);
  if (envVal !== undefined) {
    if (hasControlChar(envVal)) {
      throw new Error(`${ENV_DEFAULT_CHANNEL} must not contain control characters.`);
    }
    return envVal;
  }
  const cfg = await loadConfig(opts);
  return cfg.workspaces[team_id]?.default_channel ?? null;
}

/**
 * Resolve the output format, honouring env > config. An env value outside
 * `OUTPUT_FORMATS` throws so an unrecognised `--format=...` shell alias
 * does not silently fall back to a different renderer.
 */
export async function getOutputFormat(opts: ApiOptions = {}): Promise<OutputFormat> {
  const envVal = readEnv(opts, ENV_OUTPUT_FORMAT);
  if (envVal !== undefined) {
    if (!OUTPUT_FORMATS.includes(envVal as OutputFormat)) {
      throw new Error(`${ENV_OUTPUT_FORMAT} must be one of ${OUTPUT_FORMATS.join(", ")}.`);
    }
    return envVal as OutputFormat;
  }
  const cfg = await loadConfig(opts);
  return cfg.output.format;
}

function mergeWorkspace(
  existing: WorkspaceConfig | undefined,
  team_id: string,
  patch: Partial<WorkspaceConfig>,
): WorkspaceConfig {
  if (existing) {
    return {
      name: patch.name ?? existing.name,
      default_channel:
        "default_channel" in patch ? (patch.default_channel ?? null) : existing.default_channel,
      tokens_store: patch.tokens_store ?? existing.tokens_store,
    };
  }
  if (typeof patch.name !== "string" || patch.name.trim().length === 0) {
    throw new Error(`Cannot create workspace.${team_id}: missing required "name".`);
  }
  if (
    typeof patch.tokens_store !== "string" ||
    !TOKENS_STORES.includes(patch.tokens_store as WorkspaceConfig["tokens_store"])
  ) {
    throw new Error(
      `Cannot create workspace.${team_id}: missing or invalid "tokens_store" (one of ${TOKENS_STORES.join(", ")}).`,
    );
  }
  return {
    name: patch.name,
    default_channel: patch.default_channel ?? null,
    tokens_store: patch.tokens_store,
  };
}

/**
 * Insert or partial-update a single workspace, persisting the result.
 *
 * - For an existing workspace any subset of fields may be provided; absent
 *   fields are preserved. `default_channel` is settable to `null`.
 * - For a new workspace `name` and `tokens_store` are required.
 * - Env vars are NEVER written back to disk: this writer reads the saved
 *   `Config`, applies the patch, and saves — env values stay ephemeral.
 */
export async function setWorkspace(
  team_id: string,
  patch: Partial<WorkspaceConfig>,
  opts: ApiOptions = {},
): Promise<void> {
  assertValidTeamId(team_id);
  assertPartialWorkspaceConfig(patch);

  const cfg = await loadConfig(opts);
  const merged = mergeWorkspace(cfg.workspaces[team_id], team_id, patch);
  const next: Config = {
    default_workspace: cfg.default_workspace,
    workspaces: { ...cfg.workspaces, [team_id]: merged },
    output: { ...cfg.output },
  };
  await saveConfig(next, opts);
}

/**
 * Remove a workspace from the saved config (no-op if absent). Resets
 * `default_workspace` to `null` if it pointed at the removed entry.
 *
 * The token store implementation (Keychain / `tokens.json`) is NOT touched;
 * cleaning up the token is a secrets-layer concern handled by T010's
 * `slack-chan workspace remove` subcommand.
 */
export async function removeWorkspace(team_id: string, opts: ApiOptions = {}): Promise<void> {
  assertValidTeamId(team_id);
  const cfg = await loadConfig(opts);
  if (!(team_id in cfg.workspaces)) return;
  const nextWorkspaces: Record<string, WorkspaceConfig> = {};
  for (const [k, v] of Object.entries(cfg.workspaces)) {
    if (k !== team_id) nextWorkspaces[k] = v;
  }
  const next: Config = {
    default_workspace: cfg.default_workspace === team_id ? null : cfg.default_workspace,
    workspaces: nextWorkspaces,
    output: { ...cfg.output },
  };
  await saveConfig(next, opts);
}
