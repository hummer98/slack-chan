import { assertValidTeamId } from "../secrets/index-file.ts";
import {
  type Config,
  OUTPUT_FORMATS,
  type OutputConfig,
  TOKENS_STORES,
  type WorkspaceConfig,
} from "./types.ts";

const MIN_CACHE_WINDOW_DAYS = 1;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function fail(message: string): never {
  throw new Error(`Invalid config: ${message}`);
}

export function assertOutputConfig(value: unknown): asserts value is OutputConfig {
  if (!isPlainObject(value)) fail("output must be a table.");
  const { format, cache_window_days } = value;
  if (typeof format !== "string" || !OUTPUT_FORMATS.includes(format as OutputConfig["format"])) {
    fail(`output.format must be one of ${OUTPUT_FORMATS.join(", ")}.`);
  }
  if (typeof cache_window_days !== "number" || !Number.isFinite(cache_window_days)) {
    fail("output.cache_window_days must be a number.");
  }
  if (!Number.isInteger(cache_window_days)) {
    fail("output.cache_window_days must be an integer.");
  }
  if (cache_window_days < MIN_CACHE_WINDOW_DAYS) {
    fail(`output.cache_window_days must be >= ${MIN_CACHE_WINDOW_DAYS}.`);
  }
}

export function assertWorkspaceConfig(
  value: unknown,
  label = "workspace",
): asserts value is WorkspaceConfig {
  if (!isPlainObject(value)) fail(`${label} must be a table.`);
  const { name, default_channel, tokens_store } = value;
  if (typeof name !== "string" || name.trim().length === 0) {
    fail(`${label}.name must be a non-empty string.`);
  }
  if (default_channel !== null && typeof default_channel !== "string") {
    fail(`${label}.default_channel must be a string or null.`);
  }
  if (
    typeof tokens_store !== "string" ||
    !TOKENS_STORES.includes(tokens_store as WorkspaceConfig["tokens_store"])
  ) {
    fail(`${label}.tokens_store must be one of ${TOKENS_STORES.join(", ")}.`);
  }
}

/**
 * Validate a *partial* `WorkspaceConfig` for `setWorkspace()` callers. Each
 * supplied field must satisfy the same constraints as the full schema; missing
 * fields are allowed.
 */
export function assertPartialWorkspaceConfig(
  value: unknown,
): asserts value is Partial<WorkspaceConfig> {
  if (!isPlainObject(value)) fail("workspace patch must be a table.");
  if ("name" in value) {
    const { name } = value;
    if (typeof name !== "string" || name.trim().length === 0) {
      fail("workspace.name must be a non-empty string.");
    }
  }
  if ("default_channel" in value) {
    const { default_channel } = value;
    if (default_channel !== null && typeof default_channel !== "string") {
      fail("workspace.default_channel must be a string or null.");
    }
  }
  if ("tokens_store" in value) {
    const { tokens_store } = value;
    if (
      typeof tokens_store !== "string" ||
      !TOKENS_STORES.includes(tokens_store as WorkspaceConfig["tokens_store"])
    ) {
      fail(`workspace.tokens_store must be one of ${TOKENS_STORES.join(", ")}.`);
    }
  }
}

export function assertConfig(value: unknown): asserts value is Config {
  if (!isPlainObject(value)) fail("config root must be a table.");
  const { default_workspace, workspaces, output } = value;

  if (default_workspace !== null) {
    if (typeof default_workspace !== "string") {
      fail("default_workspace must be a string or null.");
    }
    try {
      assertValidTeamId(default_workspace);
    } catch {
      fail("default_workspace must match /^T[A-Z0-9]{1,32}$/ or be null.");
    }
  }

  if (!isPlainObject(workspaces)) {
    fail("workspaces must be a table.");
  }
  for (const [team_id, ws] of Object.entries(workspaces)) {
    try {
      assertValidTeamId(team_id);
    } catch {
      fail(`workspace key "${team_id}" must be a valid team_id (/^T[A-Z0-9]{1,32}$/).`);
    }
    assertWorkspaceConfig(ws, `workspace.${team_id}`);
  }

  assertOutputConfig(output);
}
