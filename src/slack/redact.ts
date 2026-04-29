import { redactToken } from "../secrets/redact.ts";

export const SLACK_TOKEN_PATTERN = /xox[bp]-[A-Za-z0-9-]+/g;

const DEFAULT_DEPTH = 8;

function redactString(value: string): string {
  return value.replace(SLACK_TOKEN_PATTERN, (match) => redactToken(match));
}

export function redactSecrets(value: unknown, depth: number = DEFAULT_DEPTH): unknown {
  if (depth <= 0) {
    return null;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  if (value instanceof Error) {
    const stackRedacted = typeof value.stack === "string" ? redactString(value.stack) : value.stack;
    const out: { name: string; message: string; stack?: string; cause?: unknown } = {
      name: value.name,
      message: redactString(value.message),
    };
    if (stackRedacted !== undefined) {
      out.stack = stackRedacted;
    }
    if ((value as { cause?: unknown }).cause !== undefined) {
      out.cause = redactSecrets((value as { cause?: unknown }).cause, depth - 1);
    }
    return out;
  }

  if (Array.isArray(value)) {
    return value.map((v) => redactSecrets(v, depth - 1));
  }

  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactSecrets(v, depth - 1);
    }
    return out;
  }

  return value;
}
