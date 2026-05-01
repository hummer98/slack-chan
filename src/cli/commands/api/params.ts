import { UserError } from "../../errors.ts";

export type ApiParams = Record<string, unknown>;

const PARAM_KEY_RE = /^[A-Za-z_][A-Za-z0-9_.]*$/;

interface ParsedToken {
  key: string;
  raw: string;
  json: boolean;
}

function splitToken(token: string): ParsedToken {
  const i = token.indexOf("=");
  if (i === -1) {
    throw new UserError(
      `api: parameter '${token}' is missing '=' or ':=' (expected k=v or k:=<json>).`,
    );
  }
  if (i === 0) {
    throw new UserError(`api: parameter token '${token}' has an empty key.`);
  }
  if (i >= 1 && token.charAt(i - 1) === ":") {
    const key = token.slice(0, i - 1);
    if (key.length === 0) {
      throw new UserError(`api: parameter token '${token}' has an empty key.`);
    }
    return { key, raw: token.slice(i + 1), json: true };
  }
  return { key: token.slice(0, i), raw: token.slice(i + 1), json: false };
}

function parseJsonValue(key: string, raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new UserError(`api: parameter '${key}' value is not valid JSON: ${msg}.`);
  }
}

/**
 * Parse `k=v` and `k:=<json>` argv tokens into a plain object suitable for
 * passing as `params` to `SlackClient.apiCall`. Pure function — throws
 * `UserError` on any malformed input. Duplicate keys are an error (no
 * "last wins") to prevent silent shell-history / typo accidents.
 */
export function parseApiParams(tokens: readonly string[]): ApiParams {
  const out: ApiParams = {};
  for (const token of tokens) {
    const { key, raw, json } = splitToken(token);
    if (!PARAM_KEY_RE.test(key)) {
      throw new UserError(
        `api: invalid parameter key '${key}' (must match /^[A-Za-z_][A-Za-z0-9_.]*$/).`,
      );
    }
    if (Object.hasOwn(out, key)) {
      throw new UserError(`api: parameter '${key}' is specified more than once.`);
    }
    out[key] = json ? parseJsonValue(key, raw) : raw;
  }
  return out;
}
