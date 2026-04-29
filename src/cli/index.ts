#!/usr/bin/env bun
import { parseArgs } from "node:util";
import pkg from "../../package.json" with { type: "json" };

const HELP = `slack-chan v${pkg.version} — Slack interface for Claude

Usage:
  slack-chan --version
  slack-chan --help
  slack-chan <subcommand> [options]

Subcommands (planned for Phase 2+, not yet implemented):
  config        Manage workspaces, default channels, token store
  read          Read channel history (with cache)
  post          Post a message to a channel or thread
  dm            Direct message read/write
  download      Download attachments
  user          Look up a user by id / email / @name
  search        Search cached messages
  api           Generic Slack Web API call (escape hatch)
  sync          Refresh cache for a channel
  stats         Show cache statistics

See docs/seed.md §4.3 for the planned command tree and docs/decisions/ for ADRs.
`;

export function runCli(rawArgs: readonly string[]): number {
  const { values, positionals } = parseArgs({
    args: [...rawArgs],
    options: {
      version: { type: "boolean", short: "v" },
      help: { type: "boolean", short: "h" },
    },
    strict: false,
    allowPositionals: true,
  });

  if (values.version) {
    process.stdout.write(`${pkg.version}\n`);
    return 0;
  }

  if (values.help || positionals.length === 0) {
    process.stdout.write(HELP);
    return 0;
  }

  const subcommand = positionals[0];
  process.stderr.write(
    `Subcommand "${subcommand}" is not implemented yet (see docs/seed.md §4.3).\n`,
  );
  return 1;
}

const exitCode = runCli(process.argv.slice(2));
process.exit(exitCode);
