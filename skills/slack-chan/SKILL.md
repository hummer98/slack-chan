---
name: slack-chan
description: Read and post Slack messages with multi-workspace support, default channels, and persistent local cache. Use when the user wants to read Slack channel or DM history as context, post a report or progress update to a channel/thread, look up a user profile by id/email/@name, download attached files, search cached messages, or call any Slack Web API method that doesn't have a dedicated subcommand. The CLI handles all caching, token management (macOS Keychain / 0600 file), and rate-limit-aware fetch. Tokens accepted are `xoxp-` (User OAuth) and `xoxb-` (Bot) only.
allowed-tools: Bash(slack-chan:*)
---

# slack-chan — Slack interface for Claude

`slack-chan` is a CLI that talks to Slack on behalf of Claude. It is shipped
as a Claude Code plugin so Claude can read context from Slack and post results
back without the user wiring anything up by hand.

## When to use

| User intent | Command |
|---|---|
| "Register / select workspace" / token setup | `slack-chan config workspace add/list/set-default/...` |
| "Read recent messages in #foo" / channel history as context | `slack-chan read <channel>` |
| "Post this update to #bar" / progress report | `slack-chan post <channel> <text>` |
| "Reply in this thread" | `slack-chan post <channel> <text> --thread <ts>` |
| "Read DMs with @alice" | `slack-chan dm <user> --read` |
| "Send DM to @alice" | `slack-chan dm <user> <text>` |
| "Download attachments from message X" | `slack-chan download <ts> --channel <ch>` |
| "Look up @alice / alice@example.com" | `slack-chan user <id-or-email-or-@name>` |
| "Find messages mentioning Y" | `slack-chan search <query>` |
| "Anything else from the Slack Web API" | `slack-chan api <method> key=value ...` |
| "Refresh cache for #foo" | `slack-chan sync <channel>` |
| "How big is the cache?" | `slack-chan stats` |

## Defaults

- Default workspace and channel are read from `~/.config/slack-chan/config.toml`
  and env vars `SLACK_CHAN_DEFAULT_WORKSPACE` / `SLACK_CHAN_DEFAULT_CHANNEL`.
- **Don't ask the user which workspace to use** unless they explicitly mention
  multiple — assume the default.
- Override per-call with `--workspace <team_id>`.
- `slack-chan api` requires `--workspace` explicitly (no default fallback,
  to prevent accidental cross-workspace writes).

## Output format

- Default is JSONL (one record per line). Parse it directly.
- `--toon` is currently a JSONL alias (see ADR-0009).
- Use `--human` only when the user asks to see the output themselves.

## Cache semantics

- Channel history is stored in SQLite under `~/.local/share/slack-chan/cache.db`
  (FTS5 indexed for `slack-chan search`).
- Recent N days (default 7) are refetched on every read so edits/deletes
  show up.
- Older messages are immutable.
- `--refresh` triggers a full refetch.
- Threads: parent messages are cached eagerly, replies are fetched on demand
  and written back.
- `slack-chan sync <channel>` forces an immediate cache refresh.
- `slack-chan stats` prints cache size / message counts per workspace.

## Escape hatch

When a Slack Web API method has no dedicated subcommand, use:

```sh
slack-chan api <method> [key=value ...] [key:=<json> ...] --workspace <team_id>
```

`key=value` for primitives, `key:=<json>` for arrays/objects. Reference:
https://api.slack.com/methods.

## Token policy

Only `xoxp-` (User OAuth) and `xoxb-` (Bot) tokens are accepted. `xoxc-` /
`xoxd-` browser-session tokens are **rejected at the boundary** because using
them via the Web API violates Slack's Acceptable Use Policy. Don't suggest
those formats to the user — direct them to `docs/getting-started.md` for the
proper Slack App setup.

## Output style for Claude

When summarizing results back to the user, prefer Slack's native vocabulary
(`#channel`, `@user`, thread, reaction) over generic terms. Quote `text`
fields verbatim if relevant; collapse `raw_json` unless the user asks.

<!-- keep in sync with src/cli/help.ts COMMAND_SUMMARIES -->
