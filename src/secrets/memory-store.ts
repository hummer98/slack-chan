import { assertAllowedSlackToken } from "./guard.ts";
import type { TokenStore } from "./store.ts";

/**
 * In-memory `TokenStore` for tests and Phase 1 wiring. Tokens live for the
 * lifetime of the process only and are never persisted.
 *
 * **Test-only.** Production code paths must construct a backend via
 * `createTokenStore("keychain" | "file", ...)` from `factory.ts`. This class
 * is intentionally excluded from the factory to prevent silent fallback to
 * an unpersisted store.
 *
 * `set()` routes through `assertAllowedSlackToken` to confirm the AUP
 * boundary is wired (xoxc-/xoxd- rejection).
 */
export class MemoryTokenStore implements TokenStore {
  readonly #tokens = new Map<string, string>();

  async get(team_id: string): Promise<string | undefined> {
    return this.#tokens.get(team_id);
  }

  async set(team_id: string, token: string): Promise<void> {
    assertAllowedSlackToken(token);
    this.#tokens.set(team_id, token);
  }

  async delete(team_id: string): Promise<void> {
    this.#tokens.delete(team_id);
  }

  async list(): Promise<string[]> {
    return Array.from(this.#tokens.keys());
  }
}
