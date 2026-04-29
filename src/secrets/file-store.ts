import { join } from "node:path";
import { assertAllowedSlackToken } from "./guard.ts";
import {
  assertValidTeamId,
  cleanupStaleTempFiles,
  readSecureJson,
  TOKENS_FILENAME,
  writeSecureJson,
} from "./index-file.ts";
import type { TokenStore } from "./store.ts";

export interface FileTokenStoreOptions {
  /**
   * Directory holding `tokens.json` / `index.json`. Defaults to
   * `$XDG_CONFIG_HOME/slack-chan` (or `$HOME/.config/slack-chan`).
   *
   * Tests inject a tmpdir here. Production callers should pass an explicit
   * value resolved by the CLI layer (see `factory.ts`).
   */
  configDir: string;
}

type TokenMap = Record<string, string>;

/**
 * `tokens.json`-backed `TokenStore`.
 *
 * Storage: `<configDir>/tokens.json`, mode 0o600 (parent dir 0o700).
 * Format:  `{ "<team_id>": "<token>", ... }`
 *
 * Security guarantees (see Plan §3.4):
 *  - rejects xoxc / xoxd at `set()` via `assertAllowedSlackToken`
 *  - rejects malformed `team_id` at every entrypoint (M5)
 *  - rejects symlinks on `tokens.json` and the parent dir (M1)
 *  - refuses to overwrite when the existing file is corrupt JSON (M2,
 *    fail-closed; users back up & delete to recover)
 *  - atomic write: tempfile in same dir → fsync → rename → re-chmod 600
 *  - sweeps stale `tokens.json.*.tmp` / `index.json.*.tmp` files older
 *    than 24h on every write (M3)
 *  - error messages never include the raw token (redact via
 *    `assertAllowedSlackToken`'s generic wording)
 */
export class FileTokenStore implements TokenStore {
  readonly #dir: string;

  constructor(opts: FileTokenStoreOptions) {
    this.#dir = opts.configDir;
  }

  get path(): string {
    return join(this.#dir, TOKENS_FILENAME);
  }

  async get(team_id: string): Promise<string | undefined> {
    assertValidTeamId(team_id);
    const map = await this.#readMap();
    return map?.[team_id];
  }

  async set(team_id: string, token: string): Promise<void> {
    assertValidTeamId(team_id);
    assertAllowedSlackToken(token);
    const map = (await this.#readMap()) ?? {};
    map[team_id] = token;
    await this.#writeMap(map);
  }

  async delete(team_id: string): Promise<void> {
    assertValidTeamId(team_id);
    const map = await this.#readMap();
    if (!map || !(team_id in map)) return;
    delete map[team_id];
    await this.#writeMap(map);
  }

  async list(): Promise<string[]> {
    const map = await this.#readMap();
    return map ? Object.keys(map) : [];
  }

  async #readMap(): Promise<TokenMap | undefined> {
    const data = await readSecureJson<unknown>(this.path);
    if (data === undefined) return undefined;
    if (typeof data !== "object" || data === null || Array.isArray(data)) {
      throw new Error(
        `${this.path} is not in the expected shape (object of team_id → token). Refusing to read.`,
      );
    }
    const out: TokenMap = {};
    for (const [k, v] of Object.entries(data)) {
      assertValidTeamId(k);
      if (typeof v !== "string") {
        throw new Error(`${this.path} contains a non-string token entry. Refusing to read.`);
      }
      out[k] = v;
    }
    return out;
  }

  async #writeMap(map: TokenMap): Promise<void> {
    await cleanupStaleTempFiles(this.#dir);
    await writeSecureJson(this.path, map);
  }
}
