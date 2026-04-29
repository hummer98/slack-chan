import { randomBytes } from "node:crypto";
import { chmod, lstat, mkdir, open as openFile, readFile, rename, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parse, stringify } from "smol-toml";
import { type ConfigPathOptions, resolveConfigPath } from "./path.ts";
import { assertConfig } from "./schema.ts";
import {
  type Config,
  DEFAULT_OUTPUT,
  DEFAULTS,
  type OutputConfig,
  type WorkspaceConfig,
} from "./types.ts";

export type LoadConfigOptions = ConfigPathOptions;
export type SaveConfigOptions = ConfigPathOptions;

const CONFIG_FILE_MODE = 0o600;
const CONFIG_DIR_MODE = 0o700;

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function deepFreeze<T>(obj: T): T {
  if (obj === null || typeof obj !== "object") return obj;
  if (Object.isFrozen(obj)) return obj;
  for (const key of Object.keys(obj as object)) {
    const v = (obj as Record<string, unknown>)[key];
    if (v !== null && typeof v === "object") deepFreeze(v);
  }
  return Object.freeze(obj);
}

function defaultsClone(): Config {
  return {
    default_workspace: DEFAULTS.default_workspace,
    workspaces: {},
    output: { ...DEFAULT_OUTPUT },
  };
}

/**
 * Project a parsed TOML root into a populated `Config` object.
 *
 * - `[output]` missing → fall back to `DEFAULT_OUTPUT`.
 * - `[workspace]` table missing → empty workspaces map.
 * - Inside `[workspace.<id>]`: `name` and `tokens_store` are required;
 *   `default_channel` is optional and the empty string is normalised to null.
 * - Unknown fields at any level are ignored (forward compat).
 *
 * Type-correctness of every produced field is asserted by `assertConfig`
 * after this builder returns.
 */
function buildConfig(parsed: unknown): Config {
  if (!isPlainObject(parsed)) {
    throw new Error("config root must be a TOML table.");
  }

  const default_workspace = (() => {
    const v = parsed.default_workspace;
    if (v === undefined || v === null) return null;
    return v as string;
  })();

  const workspacesIn = parsed.workspace;
  const workspaces: Record<string, WorkspaceConfig> = {};
  if (workspacesIn !== undefined) {
    if (!isPlainObject(workspacesIn)) {
      throw new Error("[workspace] must be a table.");
    }
    for (const [team_id, raw] of Object.entries(workspacesIn)) {
      if (!isPlainObject(raw)) {
        throw new Error(`[workspace.${team_id}] must be a table.`);
      }
      if (!("name" in raw)) {
        throw new Error(`[workspace.${team_id}] is missing required field "name".`);
      }
      if (!("tokens_store" in raw)) {
        throw new Error(`[workspace.${team_id}] is missing required field "tokens_store".`);
      }
      const default_channel_raw = raw.default_channel;
      const default_channel =
        default_channel_raw === undefined || default_channel_raw === ""
          ? null
          : (default_channel_raw as string | null);
      workspaces[team_id] = {
        name: raw.name as string,
        default_channel,
        tokens_store: raw.tokens_store as WorkspaceConfig["tokens_store"],
      };
    }
  }

  let output: OutputConfig;
  if (parsed.output === undefined) {
    output = { ...DEFAULT_OUTPUT };
  } else if (!isPlainObject(parsed.output)) {
    throw new Error("[output] must be a table.");
  } else {
    output = {
      format: parsed.output.format as OutputConfig["format"],
      cache_window_days: parsed.output.cache_window_days as number,
    };
  }

  return { default_workspace, workspaces, output };
}

/**
 * Project a `Config` into the on-disk TOML object shape.
 *
 * - `default_channel: null` is stored as `""` (round-trip pair of the load
 *   path which normalises `""` back to `null`).
 * - `default_workspace: null` is omitted entirely.
 */
function toTomlObject(value: Config): Record<string, unknown> {
  const root: Record<string, unknown> = {};
  if (value.default_workspace !== null) {
    root.default_workspace = value.default_workspace;
  }
  const workspaces: Record<string, Record<string, unknown>> = {};
  for (const [team_id, ws] of Object.entries(value.workspaces)) {
    workspaces[team_id] = {
      name: ws.name,
      default_channel: ws.default_channel ?? "",
      tokens_store: ws.tokens_store,
    };
  }
  if (Object.keys(workspaces).length > 0) {
    root.workspace = workspaces;
  }
  root.output = {
    format: value.output.format,
    cache_window_days: value.output.cache_window_days,
  };
  return root;
}

/**
 * Load `<configDir>/config.toml`.
 *
 * - File missing → returns a deep-frozen `DEFAULTS` snapshot (first-run case).
 * - Invalid TOML → throws (fail-closed). The error message names the path but
 *   never includes the raw file content.
 * - Missing `[output]` / `[workspace]` sections are filled with defaults
 *   (forward-compat with hand-edited or partially-populated files); missing
 *   per-workspace `name` / `tokens_store` is fatal.
 * - The returned object graph is deep-frozen so a stale snapshot cannot be
 *   mutated through a reference.
 */
export async function loadConfig(opts: LoadConfigOptions = {}): Promise<Readonly<Config>> {
  const path = resolveConfigPath(opts);
  let raw: string;
  try {
    raw = await readFile(path, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return deepFreeze(defaultsClone());
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = parse(raw);
  } catch {
    throw new Error(
      `${path} contains invalid TOML. Refusing to read or overwrite (fail-closed). Inspect/back up the file, then delete it to re-initialize.`,
    );
  }
  const built = buildConfig(parsed);
  assertConfig(built);
  return deepFreeze(built);
}

/**
 * Atomically persist `<configDir>/config.toml`.
 *
 * - mkdir -p the parent dir (mode 0o700 on creation; existing dir mode is
 *   left untouched so we never downgrade a stricter setting).
 * - tempfile in same dir → fsync → rename → re-chmod 0o600 (umask
 *   insurance; matches `secrets/index-file.ts` flow).
 * - Refuses to write if the input fails `assertConfig`.
 * - Refuses to write if the destination is a symlink (TOCTOU mitigation).
 */
export async function saveConfig(value: Config, opts: SaveConfigOptions = {}): Promise<void> {
  assertConfig(value);
  const path = resolveConfigPath(opts);
  const dir = dirname(path);

  await mkdir(dir, { recursive: true, mode: CONFIG_DIR_MODE });

  // Symlink check on destination, if it already exists. Refusing to write
  // through a symlink mirrors the secrets layer's M1 mitigation.
  try {
    const existing = await lstat(path);
    if (existing.isSymbolicLink()) {
      throw new Error(
        `${path} is a symlink and cannot be trusted; remove the symlink and \`chmod 600\` the original file.`,
      );
    }
    if (!existing.isFile()) {
      throw new Error(`${path} is not a regular file.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  const serialized = stringify(toTomlObject(value));

  const tmpName = `config.toml.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const tmpPath = join(dir, tmpName);
  const fd = await openFile(tmpPath, "wx", CONFIG_FILE_MODE);
  let renamed = false;
  try {
    await fd.writeFile(serialized);
    await fd.sync();
    await fd.close();

    // TOCTOU re-check before rename.
    try {
      const recheck = await lstat(path);
      if (recheck.isSymbolicLink()) {
        throw new Error(
          `${path} is a symlink and cannot be trusted; remove the symlink and \`chmod 600\` the original file.`,
        );
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    await rename(tmpPath, path);
    renamed = true;
    // Insurance: ensure mode 0o600 regardless of umask or stale destination.
    await chmod(path, CONFIG_FILE_MODE);
  } finally {
    if (!renamed) {
      await unlink(tmpPath).catch(() => {});
    }
  }
}
