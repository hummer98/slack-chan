import { setWorkspace } from "../../../config/api.ts";
import { loadConfig } from "../../../config/io.ts";
import { TOKENS_STORES, type TokensStore } from "../../../config/types.ts";
import { assertAllowedSlackToken } from "../../../secrets/guard.ts";
import * as workspacesDao from "../../../storage/dao/workspaces.ts";
import { TransientError, UserError } from "../../errors.ts";
import { EXIT_OK } from "../../exit-codes.ts";
import type { CommandContext } from "../../router.ts";
import { parseConfigArgv } from "./argv.ts";
import type { Effects } from "./effects.ts";

const USAGE =
  "Usage: slack-chan config workspace add --token=<xoxp|xoxb> [--name=<str>] [--tokens-store=<keychain|file>]";

type AddArgs = {
  token?: string;
  name?: string;
  "tokens-store"?: string;
} & Record<string, unknown>;

function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export async function workspaceAddHandler(ctx: CommandContext, effects: Effects): Promise<number> {
  const { values } = parseConfigArgv<AddArgs>(
    ctx.rest,
    {
      token: { type: "string" },
      name: { type: "string" },
      "tokens-store": { type: "string" },
    },
    { command: "config workspace add", usage: USAGE },
  );

  const token = values.token;
  if (typeof token !== "string" || token.length === 0) {
    throw new UserError(`config workspace add: --token is required.\n${USAGE}`);
  }

  // AUP guard: Slack に送信する前に xoxc-/xoxd- を弾く。
  try {
    assertAllowedSlackToken(token);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(`config workspace add: ${msg}`);
  }

  if (typeof values.name === "string") {
    if (values.name.trim().length === 0 || hasControlChar(values.name)) {
      throw new UserError(
        `config workspace add: --name must be a non-empty printable string.\n${USAGE}`,
      );
    }
  }

  const cfg = await loadConfig({ configDir: effects.configDir, env: effects.env });
  const existingTeams = Object.keys(cfg.workspaces);

  let kind: TokensStore;
  if (typeof values["tokens-store"] === "string") {
    const requested = values["tokens-store"];
    if (!TOKENS_STORES.includes(requested as TokensStore)) {
      throw new UserError(
        `config workspace add: --tokens-store must be one of ${TOKENS_STORES.join(", ")}.\n${USAGE}`,
      );
    }
    kind = requested as TokensStore;
    if (existingTeams.length > 0) {
      const incumbent = cfg.workspaces[existingTeams[0] ?? ""]?.tokens_store;
      if (incumbent !== undefined && incumbent !== kind) {
        throw new UserError(
          `config workspace add: --tokens-store=${kind} conflicts with existing workspaces using ${incumbent}. ` +
            `Run \`slack-chan config tokens-store ${kind}\` first to migrate, then re-add.`,
        );
      }
    }
  } else if (existingTeams.length > 0) {
    const incumbent = cfg.workspaces[existingTeams[0] ?? ""]?.tokens_store;
    kind = (incumbent ?? effects.resolveDefaultTokensStore(effects.platform)) as TokensStore;
  } else {
    kind = effects.resolveDefaultTokensStore(effects.platform);
  }

  // 1. AUP guard を通過済みのトークンを TokenStore に保存する。
  //    （実際のチェックは parseConfigArgv 直後に assertAllowedSlackToken で実施済み。
  //     store.set でも guard は再度走るので二重防御。）
  const store = effects.createTokenStore(kind);

  // auth.test で workspace 情報を取得。403/network-failure は TransientError。
  const tmpClient = effects.createSlackClient("T00000000PLACEHOLDER", token);
  let auth: {
    ok?: boolean;
    team_id?: string;
    team?: string;
    url?: string;
    error?: string;
  };
  try {
    auth = (await tmpClient.authTest()) as typeof auth;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new TransientError(`config workspace add: auth.test failed: ${msg}`);
  }
  if (auth.ok !== true || typeof auth.team_id !== "string" || auth.team_id.length === 0) {
    const detail = auth.error ?? "unknown";
    throw new TransientError(`config workspace add: auth.test returned not-ok (${detail})`);
  }

  const team_id = auth.team_id;
  const name =
    typeof values.name === "string" && values.name.trim().length > 0
      ? values.name
      : (auth.team ?? team_id);
  const url = typeof auth.url === "string" && auth.url.length > 0 ? auth.url : null;

  // 2. TokenStore に保存（assertAllowedSlackToken が xoxc/xoxd を弾く）
  await store.set(team_id, token);

  // 3. workspaces テーブルに upsert。db ライフサイクルは effects 提供側
  // （defaultEffects は openDatabase() を都度呼び、process 終了時に解放される）
  // が責任を持つ。テストも同じ db ハンドルでアサートしたいので close しない。
  const db = effects.openDb();
  const existingRow = workspacesDao.get(db, team_id);
  if (existingRow !== null) {
    workspacesDao.upsert(db, {
      team_id,
      name,
      url,
      default_channel: null,
      added_at: existingRow.added_at,
    });
  } else {
    workspacesDao.insert(db, {
      team_id,
      name,
      url,
      default_channel: null,
      added_at: Math.floor(Date.now() / 1000),
    });
  }

  // 4. config TOML に setWorkspace
  const existingWs = cfg.workspaces[team_id];
  await setWorkspace(
    team_id,
    {
      name,
      tokens_store: kind,
      ...(existingWs === undefined ? { default_channel: null } : {}),
    },
    { configDir: effects.configDir, env: effects.env },
  );

  ctx.logger.info(`workspace added: ${team_id} (${name})`);
  return EXIT_OK;
}
