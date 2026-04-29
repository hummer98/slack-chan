/**
 * `TokenStore` is the unified interface for the Phase 2 secret backends
 * (`KeychainTokenStore`, `FileTokenStore`). Methods take a Slack `team_id`
 * (e.g. `T01ABCDEF`) — the canonical workspace identifier returned by
 * `auth.test`.
 *
 * Backends MUST route every `set()` call through `assertAllowedSlackToken`
 * to enforce the xoxc / xoxd rejection (Slack AUP, see docs/seed.md §3.3).
 */
export interface TokenStore {
  get(team_id: string): Promise<string | undefined>;
  set(team_id: string, token: string): Promise<void>;
  delete(team_id: string): Promise<void>;
  list(): Promise<string[]>;
}
