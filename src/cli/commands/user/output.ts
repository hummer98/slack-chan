/**
 * The record emitted on stdout when `user` succeeds. Always `ok: true` —
 * any non-ok response from Slack is converted to a `CliError` upstream.
 *
 *   - `profile` は `UserRow.profile_json` を JSON.parse した結果 (Slack member 全体)。
 *     parse に失敗した場合 null。
 *   - `fetched_at` は unix ms。
 */
export interface UserResult {
  ok: true;
  user: {
    team_id: string;
    user_id: string;
    name: string | null;
    real_name: string | null;
    email: string | null;
    profile: unknown;
    fetched_at: number;
  };
}
