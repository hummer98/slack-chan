import { homedir } from "node:os";
import { join } from "node:path";

export interface ConfigPathOptions {
  /**
   * Override the config dir. Defaults to:
   * `$XDG_CONFIG_HOME/slack-chan` (or `$HOME/.config/slack-chan`).
   *
   * Tests inject a tmpdir here. Production CLI code should pass an explicit
   * value resolved at startup so a stale env var cannot redirect a single
   * call mid-run.
   */
  configDir?: string;
  /**
   * Override the environment for path resolution (test-only). When omitted
   * `process.env` is consulted.
   */
  env?: NodeJS.ProcessEnv;
}

const APP_DIRNAME = "slack-chan";
const CONFIG_FILENAME = "config.toml";

/**
 * Resolve the directory holding `config.toml` / `tokens.json` / `index.json`.
 *
 * Precedence:
 *   1. `opts.configDir` (when non-empty after trim).
 *   2. `$XDG_CONFIG_HOME/slack-chan` (when non-empty after trim).
 *   3. `$HOME/.config/slack-chan`.
 *
 * Used by both the config layer and `src/secrets/factory.ts` so that a single
 * directory hosts all on-disk state for the CLI.
 */
export function resolveConfigDir(opts: ConfigPathOptions = {}): string {
  const explicit = opts.configDir;
  if (typeof explicit === "string" && explicit.trim().length > 0) return explicit;
  const env = opts.env ?? process.env;
  const xdg = env.XDG_CONFIG_HOME?.trim();
  if (xdg && xdg.length > 0) return join(xdg, APP_DIRNAME);
  return join(homedir(), ".config", APP_DIRNAME);
}

/** `<configDir>/config.toml`. */
export function resolveConfigPath(opts: ConfigPathOptions = {}): string {
  return join(resolveConfigDir(opts), CONFIG_FILENAME);
}
