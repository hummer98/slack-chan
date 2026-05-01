/**
 * 出力フォーマット。CLI `--json|--toon|--human|--rich` と対応（docs/seed.md §3.5、ADR-0014）。
 */
export type OutputFormat = "jsonl" | "toon" | "human" | "rich";
export const OUTPUT_FORMATS: readonly OutputFormat[] = ["jsonl", "toon", "human", "rich"];

/**
 * トークン保管バックエンド。`src/secrets/factory.ts` の `TokenStoreKind` と
 * 同一概念のため、両者は本ファイルの型を canonical として参照する。
 */
export type TokensStore = "keychain" | "file";
export const TOKENS_STORES: readonly TokensStore[] = ["keychain", "file"];

export interface WorkspaceConfig {
  /** 表示用の workspace 名（`auth.test` の team / team_name 由来）。 */
  name: string;
  /** デフォルトの channel id (`C…`) または name (`#general`)。未設定時は null。 */
  default_channel: string | null;
  /** この workspace に対するトークン保管先。 */
  tokens_store: TokensStore;
}

export interface OutputConfig {
  format: OutputFormat;
  /** 編集追従 window の日数（docs/seed.md §3.5.2、default 7）。 */
  cache_window_days: number;
}

export interface Config {
  /** デフォルト workspace の team_id (`T…`)。未設定時は null。 */
  default_workspace: string | null;
  /** team_id をキーとする workspace map。 */
  workspaces: Readonly<Record<string, WorkspaceConfig>>;
  output: OutputConfig;
}

/**
 * `loadConfig` がファイル不存在 / 各セクション欠落時に返す正準値。
 * deep-frozen so a caller cannot mutate the canonical default.
 */
export const DEFAULT_OUTPUT: Readonly<OutputConfig> = Object.freeze({
  format: "jsonl",
  cache_window_days: 7,
}) satisfies Readonly<OutputConfig>;

export const DEFAULTS: Readonly<Config> = Object.freeze({
  default_workspace: null,
  workspaces: Object.freeze({}) as Readonly<Record<string, WorkspaceConfig>>,
  output: DEFAULT_OUTPUT,
}) satisfies Readonly<Config>;
