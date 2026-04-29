import { assertAllowedSlackToken } from "./guard.ts";

/**
 * Phase 1: define the storage interface and provide an in-memory placeholder
 * implementation so consumers can wire to a stable type. Phase 2 will swap
 * the implementation to Keychain (macOS) / Secret Service (Linux) / 0600
 * file fallback. See docs/seed.md §3.3.
 */
export interface TokenStore {
  get(workspace: string): Promise<string | undefined>;
  set(workspace: string, token: string): Promise<void>;
  remove(workspace: string): Promise<void>;
}

/**
 * In-memory TokenStore for Phase 1. Tokens live for the lifetime of the
 * process only. `set()` routes through `assertAllowedSlackToken` to confirm
 * the AUP boundary is wired (xoxc-/xoxd- rejection).
 */
export class MemoryTokenStore implements TokenStore {
  readonly #tokens = new Map<string, string>();

  get(workspace: string): Promise<string | undefined> {
    return Promise.resolve(this.#tokens.get(workspace));
  }

  set(workspace: string, token: string): Promise<void> {
    assertAllowedSlackToken(token);
    this.#tokens.set(workspace, token);
    return Promise.resolve();
  }

  remove(workspace: string): Promise<void> {
    this.#tokens.delete(workspace);
    return Promise.resolve();
  }
}
