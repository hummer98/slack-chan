import { resolveConfigDir } from "../config/path.ts";
import type { TokensStore } from "../config/types.ts";
import { FileTokenStore } from "./file-store.ts";
import { KeychainTokenStore, whichSecuritySync } from "./keychain-store.ts";
import type { TokenStore } from "./store.ts";

/**
 * Backend selector for {@link createTokenStore}. Identical to the config-layer
 * `TokensStore` (`src/config/types.ts`) — re-exported here so secrets callers
 * do not have to reach into `config/` for a single type alias.
 */
export type TokenStoreKind = TokensStore;

export interface TokenStoreOptions {
  /**
   * Override the config dir. Defaults to:
   * `$XDG_CONFIG_HOME/slack-chan` (or `$HOME/.config/slack-chan`).
   *
   * Tests inject a tmpdir here. T010's `slack-chan config tokens-store`
   * subcommand should always pass this explicitly so the factory's
   * fallback resolution cannot silently point at a different directory.
   */
  configDir?: string;
  /** Keychain service name. Defaults to `slack-chan`. */
  service?: string;
}

/**
 * Construct a `TokenStore` for the requested backend.
 *
 * - `"file"`: always available; persists to `<configDir>/tokens.json`.
 * - `"keychain"`: macOS only. Throws on non-darwin platforms or when the
 *   `security` CLI is missing. Silent fallback is intentionally NOT
 *   implemented — choosing keychain on Linux must surface as a hard error.
 *
 * `MemoryTokenStore` is intentionally NOT exposed here (it is for tests
 * and Phase 1 only); see `src/secrets/memory-store.ts`.
 */
export function createTokenStore(
  kind: TokenStoreKind,
  options: TokenStoreOptions = {},
): TokenStore {
  const configDir = resolveConfigDir({ configDir: options.configDir });
  switch (kind) {
    case "file":
      return new FileTokenStore({ configDir });
    case "keychain": {
      if (process.platform !== "darwin") {
        throw new Error(
          "Keychain backend is macOS-only. Use --tokens-store=file on this platform " +
            "(see docs/decisions/0007-linux-keychain.md).",
        );
      }
      if (!whichSecuritySync()) {
        throw new Error(
          "macOS 'security' command not found on PATH. Use --tokens-store=file " +
            "or repair the system installation.",
        );
      }
      return new KeychainTokenStore({ configDir, service: options.service });
    }
    default: {
      const exhaustive: never = kind;
      throw new Error(`Unknown TokenStore kind: ${String(exhaustive)}`);
    }
  }
}
