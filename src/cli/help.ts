import pkg from "../../package.json" with { type: "json" };

interface CommandSummary {
  readonly name: string;
  readonly summary: string;
}

const COMMAND_SUMMARIES: readonly CommandSummary[] = [
  { name: "config", summary: "Manage workspaces, default channels, token store" },
  { name: "read", summary: "Read channel history (with cache)" },
  { name: "post", summary: "Post a message to a channel or thread" },
  { name: "dm", summary: "Direct message read/write" },
  { name: "download", summary: "Download attachments" },
  { name: "user", summary: "Look up a user by id / email / @name" },
  { name: "search", summary: "Search cached messages" },
  { name: "api", summary: "Generic Slack Web API call (escape hatch)" },
  { name: "sync", summary: "Refresh cache for a channel" },
  { name: "stats", summary: "Show cache statistics" },
];

export function buildTopLevelHelp(): string {
  const cmdLines = COMMAND_SUMMARIES.map((c) => `  ${c.name.padEnd(10)}  ${c.summary}`).join("\n");
  return `slack-chan v${pkg.version} — Slack interface for Claude

Usage:
  slack-chan --version
  slack-chan --help
  slack-chan [global-flags] <subcommand> [options]

Global flags:
  --workspace <T...>   Target workspace team_id (overrides config / env)
  --json               Emit JSONL (default)
  --toon               Emit TOON (currently delegates to JSONL — see ADR-0009)
  --human              Emit human-readable formatting (timeline / table / card; see ADR-0013)
  --verbose            Enable debug-level logging on stderr
  -h, --help           Show this help and exit
  -v, --version        Show version and exit

Subcommands:
${cmdLines}

Subcommands are stubs in T009 (Phase 3). Each one is implemented in T010+.
See docs/seed.md §4.3 for the planned command tree and docs/decisions/ for ADRs.
`;
}
