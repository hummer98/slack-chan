import { UserError } from "../../errors.ts";
import type { Effects } from "./effects.ts";

function describeJsonShape(parsed: unknown): string {
  if (parsed === null) return "null";
  return typeof parsed;
}

/**
 * Resolve the `--blocks=<value>` flag. The first non-whitespace character
 * decides the route:
 *   - `{` or `[` → treat as inline JSON (parse the value verbatim).
 *   - otherwise  → treat as a path, read file as UTF-8, then JSON.parse.
 *
 * Slack expects an array of block objects, so we reject any non-array result
 * with a message that includes the actual shape (helps users notice they
 * passed an object literal instead of `[...]`).
 */
export async function loadBlocks(value: string, effects: Effects): Promise<unknown[]> {
  const trimmed = value.trimStart();
  let raw: string;
  let source: "inline" | "file";
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    raw = value;
    source = "inline";
  } else {
    source = "file";
    try {
      raw = await effects.readFile(value);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        throw new UserError(`post: --blocks file '${value}' not found.`);
      }
      const msg = err instanceof Error ? err.message : String(err);
      throw new UserError(`post: --blocks file '${value}' could not be read: ${msg}`);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    const inner = err instanceof Error ? err.message : String(err);
    const where = source === "file" ? ` (file '${value}')` : "";
    throw new UserError(`post: --blocks is not valid JSON${where}: ${inner}`);
  }

  if (!Array.isArray(parsed)) {
    throw new UserError(
      `post: --blocks must be a JSON array of block objects (got ${describeJsonShape(parsed)}).`,
    );
  }
  return parsed;
}
