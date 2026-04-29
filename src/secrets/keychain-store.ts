import { execFile as execFileCb, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { assertAllowedSlackToken } from "./guard.ts";
import { assertValidTeamId, cleanupStaleTempFiles, readIndex, writeIndex } from "./index-file.ts";
import { redactToken } from "./redact.ts";
import type { TokenStore } from "./store.ts";

const execFile = promisify(execFileCb);

const DEFAULT_SERVICE = "slack-chan";
const SECURITY_BIN = "/usr/bin/security";

/** Apple Keychain CLI exit codes we care about. */
const SEC_ERR_ITEM_NOT_FOUND = 44;
const SEC_ERR_USER_CANCELED = 25;

/**
 * Synchronous probe for the macOS `security` CLI. Used by tests and the
 * `factory` to gate Keychain backend availability without hanging on a
 * locked keychain or a missing tool.
 */
export function whichSecuritySync(): boolean {
  if (process.platform !== "darwin") return false;
  try {
    execFileSync(SECURITY_BIN, ["help"], {
      stdio: "ignore",
      timeout: 2000,
    });
    return true;
  } catch {
    return false;
  }
}

export interface KeychainTokenStoreOptions {
  /**
   * Directory holding `index.json` (the team_id list mirrored alongside
   * the Keychain entries). Same dir convention as `FileTokenStore`.
   */
  configDir: string;
  /**
   * Keychain service name. Defaults to `slack-chan`. Tests pass a unique
   * `slack-chan-test-...` so a crash cannot stomp on a real workspace.
   */
  service?: string;
}

interface ExecError extends Error {
  code?: number;
  stderr?: string;
  stdout?: string;
}

function isExecError(e: unknown): e is ExecError {
  return typeof e === "object" && e !== null && "code" in e;
}

/**
 * `security`-backed `TokenStore` for macOS Keychain.
 *
 * - `set / get / delete` go to the Keychain via `execFile` (no shell).
 * - `list()` reads `<configDir>/index.json` (Keychain CLI cannot enumerate
 *   one service efficiently — see Plan §3.2).
 * - team_id is format-validated before reaching argv (M5: argument
 *   injection guard).
 * - exit code 44 (errSecItemNotFound) → `get` undefined / `delete` no-op.
 * - exit code 25 (User canceled) → throw.
 * - anything else → wrap and throw with stderr redacted via `redactToken`.
 */
export class KeychainTokenStore implements TokenStore {
  readonly #dir: string;
  readonly #service: string;

  constructor(opts: KeychainTokenStoreOptions) {
    this.#dir = opts.configDir;
    this.#service = opts.service ?? DEFAULT_SERVICE;
  }

  async get(team_id: string): Promise<string | undefined> {
    assertValidTeamId(team_id);
    try {
      const { stdout } = await execFile(SECURITY_BIN, [
        "find-generic-password",
        "-s",
        this.#service,
        "-a",
        team_id,
        "-w",
      ]);
      // `-w` emits the password followed by a single newline.
      return stdout.replace(/\n$/, "");
    } catch (err) {
      if (isExecError(err) && err.code === SEC_ERR_ITEM_NOT_FOUND) return undefined;
      throw this.#wrapSecurityError(err, "find-generic-password");
    }
  }

  async set(team_id: string, token: string): Promise<void> {
    assertValidTeamId(team_id);
    assertAllowedSlackToken(token);
    try {
      // -U updates the entry if it exists, suppresses the GUI prompt on
      // subsequent writes.
      await execFile(SECURITY_BIN, [
        "add-generic-password",
        "-U",
        "-s",
        this.#service,
        "-a",
        team_id,
        "-w",
        token,
      ]);
    } catch (err) {
      throw this.#wrapSecurityError(err, "add-generic-password");
    }
    await this.#addToIndex(team_id);
  }

  async delete(team_id: string): Promise<void> {
    assertValidTeamId(team_id);
    try {
      await execFile(SECURITY_BIN, ["delete-generic-password", "-s", this.#service, "-a", team_id]);
    } catch (err) {
      if (isExecError(err) && err.code === SEC_ERR_ITEM_NOT_FOUND) {
        // no-op for missing entry.
      } else {
        throw this.#wrapSecurityError(err, "delete-generic-password");
      }
    }
    await this.#removeFromIndex(team_id);
  }

  async list(): Promise<string[]> {
    return readIndex(this.#dir);
  }

  async #addToIndex(team_id: string): Promise<void> {
    await cleanupStaleTempFiles(this.#dir);
    const current = await readIndex(this.#dir);
    if (current.includes(team_id)) return;
    await writeIndex(this.#dir, [...current, team_id]);
  }

  async #removeFromIndex(team_id: string): Promise<void> {
    await cleanupStaleTempFiles(this.#dir);
    const current = await readIndex(this.#dir);
    const next = current.filter((id) => id !== team_id);
    if (next.length === current.length) return;
    await writeIndex(this.#dir, next);
  }

  #wrapSecurityError(err: unknown, op: string): Error {
    if (isExecError(err)) {
      if (err.code === SEC_ERR_USER_CANCELED) {
        return new Error(`Keychain access was canceled by the user (security ${op}).`);
      }
      // Redact stderr to ensure no raw token leaked through (e.g. via
      // verbose error output from `security`).
      const stderr = (err.stderr ?? "").trim();
      const safeStderr = stderr.length > 0 ? scrubTokens(stderr) : "(no stderr)";
      const code = err.code ?? "?";
      return new Error(`security ${op} failed (exit ${code}): ${safeStderr}`);
    }
    return err instanceof Error ? err : new Error(String(err));
  }
}

/**
 * Replace any xoxp-/xoxb- token-shaped substring with its redacted form.
 * Defensive: stderr from `security` is unlikely to contain tokens, but if
 * something inside Keychain ever echoed one back we must not leak it.
 */
function scrubTokens(s: string): string {
  return s.replace(/xox[pb]-[A-Za-z0-9-]+/g, (m) => redactToken(m));
}
