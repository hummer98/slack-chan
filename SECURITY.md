# Security Policy

slack-chan is a Slack interface tool that handles workspace tokens. This document describes how to report a vulnerability and what users should know about the project's token-handling stance.

## Reporting a Vulnerability

Please **do not** report security vulnerabilities through public GitHub Issues, Discussions, or Pull Requests.

### Primary channel: GitHub Private Vulnerability Reporting (PVR)

Use the repository's [Private Vulnerability Reporting form](https://github.com/hummer98/slack-chan/security/advisories/new). PVR keeps the report confidential between the reporter and the maintainers, and lets us coordinate a fix and advisory through GitHub's built-in workflow.

### Secondary channel: email

If you do not have a GitHub account or cannot use PVR for any reason, send a report to **`security@example.com`**.

> **Note:** `security@example.com` is a placeholder. The maintainer will replace it with the real contact address before this file is merged to `main`. If you see this placeholder in a published copy of the file, please open an Issue (without sensitive details) so the maintainer can fix it.

### What to include

- A clear description of the impact and the affected component (e.g. `src/secrets/guard.ts`, CLI surface, on-disk storage).
- Reproduction steps or a minimal proof-of-concept.
- The version of slack-chan you tested against (`slack-chan --version`) and your environment (OS, Bun version).
- Any suggested mitigation, if you have one.

Please **do not include real Slack tokens, message bodies, user IDs, channel IDs, email addresses, or other PII** in your report. Redact or describe them abstractly.

### Response timeline (best-effort, not an SLA)

slack-chan is an open-source, solo-maintained project. We aim for the following timeline as a best-effort target, **not a contractual SLA**:

- Acknowledgement of receipt: within **7 days**.
- Triage and initial assessment: within **30 days**.
- Fix and coordinated disclosure (advisory publication): within **90 days** of the initial report, or sooner if a workaround is unavailable.

If a report has not been acknowledged after 7 days, please re-send via the secondary channel.

## Supported Versions

slack-chan is currently in **Phase 1** (pre-1.0). Only the **latest published version** receives security fixes during this phase.

| Version | Supported |
|---------|-----------|
| Latest minor (`x.y.*`) | Yes |
| Anything older         | No  |

A formal support matrix will be introduced once `1.0.0` ships.

## Slack Token Handling — User Responsibility

slack-chan is a CLI that authenticates against Slack on the user's behalf. **Users are responsible for issuing, storing, and rotating their own Slack tokens.** The project's stance on token handling is:

- **Tokens are never sent to logs, telemetry, or crash-report endpoints.** slack-chan does not operate any analytics or crash-reporting service. The maintainer's policy is that token material must not appear in stdout/stderr, log files, or any outbound network call other than the Slack API itself. Implementation of redaction and storage hardening is tracked under Phase 2+ of the roadmap (`docs/seed.md` §6.2).
- **Recommended storage** is the OS keychain when available, or a local file with `chmod 600` permissions. See `docs/seed.md` §6.2.
- If you suspect a token has leaked, **revoke it immediately** in your Slack workspace's *App Management* / *OAuth & Permissions* page, then rotate. Slack's official guide: <https://slack.com/help/articles/115005265703>.

If you find a code path where a token could be written to a log, telemetry sink, error message, or any outbound destination other than `slack.com`, please report it through the channels above — that is a security bug.

## Acceptable Use Policy / Token Type Restrictions

slack-chan **intentionally rejects** Slack browser-session tokens (`xoxc-` and `xoxd-`). Using those token types violates Slack's Acceptable Use Policy and is treated by Slack as unauthorized scraping.

- The reject logic lives in `src/secrets/guard.ts` (`assertAllowedSlackToken`) and is covered by the test suite under `tests/secrets/guard.test.ts`.
- Background and rationale: `docs/seed.md` §3.3 (rejected token types) and §6.1 (Slack ToS / AUP).
- The README's "Slack ToS / Acceptable Use Policy" section is the user-facing summary.

Use cases that require `xoxc-` or `xoxd-` (for example fetching a user's full DM history or accessing `file_private` URLs without bot installation) are **out of scope** for this project and will not be supported. Please use Slack's official APIs with `xoxp-` (User OAuth) or `xoxb-` (Bot) tokens only.

## Coordinated Disclosure

We prefer **coordinated disclosure**: please give the maintainer a reasonable window (target 90 days, see above) to ship a fix and publish an advisory before any public write-up. If a vulnerability is being actively exploited in the wild, contact us first so we can prioritize a release.

Thank you for helping keep slack-chan and its users safe.
