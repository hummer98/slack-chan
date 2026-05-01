#!/usr/bin/env bun
/**
 * Record a single Slack API response into `tests/fixtures/slack/<method>/<scenario>.json`
 * as a `SlackFixtureRaw` (redacted: false). The output MUST be passed through
 * `bun run redact-fixtures` before being committed.
 *
 * This script is a manual developer tool — the test suite never invokes it.
 * Usage:
 *   SLACK_CHAN_RECORD=1 bun run record-fixtures -- \
 *       --method auth.test --scenario ok [--params '{"k":"v"}'] \
 *       [--team-id T01ABCDEF] [--overwrite] [--tokens-store file|keychain]
 *
 * Auth resolution order:
 *   1. SLACK_CHAN_TEST_TOKEN + SLACK_CHAN_TEST_TEAM_ID env (CI / sandbox)
 *   2. TokenStore lookup by --team-id
 */
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createTokenStore, type TokenStoreKind } from "../src/secrets/factory.ts";
import { SlackClient } from "../src/slack/client.ts";
import type { SlackFixtureRaw } from "../src/testing/fixture-types.ts";

interface CliArgs {
  method?: string;
  scenario?: string;
  params?: string;
  teamId?: string;
  overwrite: boolean;
  tokensStore: TokenStoreKind;
}

function parseArgs(argv: string[]): CliArgs {
  const out: CliArgs = { overwrite: false, tokensStore: "file" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--method":
        out.method = argv[++i];
        break;
      case "--scenario":
        out.scenario = argv[++i];
        break;
      case "--params":
        out.params = argv[++i];
        break;
      case "--team-id":
        out.teamId = argv[++i];
        break;
      case "--overwrite":
        out.overwrite = true;
        break;
      case "--tokens-store": {
        const v = argv[++i];
        if (v !== "file" && v !== "keychain") {
          throw new Error(`--tokens-store must be 'file' or 'keychain' (got ${v})`);
        }
        out.tokensStore = v;
        break;
      }
      default:
        if (a !== undefined && a.startsWith("--")) {
          throw new Error(`unknown flag: ${a}`);
        }
    }
  }
  return out;
}

function printUsage(): void {
  process.stderr.write(
    [
      "Usage: SLACK_CHAN_RECORD=1 bun run record-fixtures -- \\",
      "    --method <slack.method> --scenario <kebab-case> \\",
      "    [--params '<json>'] [--team-id T01ABCDEF] \\",
      "    [--overwrite] [--tokens-store file|keychain]",
      "",
      "Auth: SLACK_CHAN_TEST_TOKEN + SLACK_CHAN_TEST_TEAM_ID, OR --team-id (TokenStore lookup).",
      "After recording, run `bun run redact-fixtures` before committing.",
      "",
    ].join("\n"),
  );
}

async function resolveAuth(
  args: CliArgs,
): Promise<{ token: string; team_id: string }> {
  const envToken = process.env.SLACK_CHAN_TEST_TOKEN;
  const envTeam = process.env.SLACK_CHAN_TEST_TEAM_ID;
  if (envToken !== undefined && envTeam !== undefined) {
    return { token: envToken, team_id: envTeam };
  }
  if (args.teamId === undefined) {
    throw new Error(
      "no auth source: set SLACK_CHAN_TEST_TOKEN+SLACK_CHAN_TEST_TEAM_ID, or pass --team-id",
    );
  }
  const store = createTokenStore(args.tokensStore);
  const token = await store.get(args.teamId);
  if (token === undefined) {
    throw new Error(`TokenStore (${args.tokensStore}) has no token for team_id=${args.teamId}`);
  }
  return { token, team_id: args.teamId };
}

interface AxiosLike {
  axios: {
    interceptors: {
      response: {
        use: (
          fulfilled: (res: { status: number; data: unknown }) => unknown,
        ) => unknown;
      };
    };
  };
}

async function main(): Promise<number> {
  if (process.env.SLACK_CHAN_RECORD !== "1") {
    process.stderr.write(
      "[record-fixtures] refusing to run without SLACK_CHAN_RECORD=1.\n",
    );
    printUsage();
    return 1;
  }

  let args: CliArgs;
  try {
    args = parseArgs(Bun.argv.slice(2));
  } catch (e) {
    process.stderr.write(`[record-fixtures] ${(e as Error).message}\n`);
    printUsage();
    return 1;
  }

  if (args.method === undefined || args.scenario === undefined) {
    process.stderr.write("[record-fixtures] --method and --scenario are required.\n");
    printUsage();
    return 1;
  }

  const params = args.params !== undefined
    ? (JSON.parse(args.params) as Record<string, unknown>)
    : null;

  const auth = await resolveAuth(args);
  const client = new SlackClient({ team_id: auth.team_id, token: auth.token });

  let captured: { status: number; data: unknown } | undefined;
  const internal = (client as unknown as { client: AxiosLike }).client;
  internal.axios.interceptors.response.use((res) => {
    captured = { status: res.status, data: res.data };
    return res;
  });

  const responseData = await client.apiCall(args.method, params ?? {});

  const outPath = `tests/fixtures/slack/${args.method}/${args.scenario}.json`;
  if (existsSync(outPath) && !args.overwrite) {
    process.stderr.write(
      `[record-fixtures] ${outPath} already exists. Use --overwrite to replace.\n`,
    );
    return 1;
  }

  const fixture: SlackFixtureRaw = {
    method: args.method,
    params,
    status: captured?.status ?? 200,
    data: responseData as Record<string, unknown>,
    recorded_at: new Date().toISOString(),
    redacted: false,
  };

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  process.stderr.write(
    `[record-fixtures] wrote ${outPath} — run \`bun run redact-fixtures\` before committing.\n`,
  );
  return 0;
}

const code = await main();
process.exit(code);
