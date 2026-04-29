import { createInterface } from "node:readline";
import { UserError } from "../../errors.ts";

export interface PromptOptions {
  /** Question text. `[y/N]: ` is appended automatically. */
  question: string;
  /** When `true`, skip prompting entirely. Caller passes `--yes` here. */
  yes?: boolean;
  /** Override TTY detection. Defaults to `process.stdin.isTTY`. */
  isTTY?: boolean;
  /** Stdin override (test-only). Defaults to `process.stdin`. */
  input?: NodeJS.ReadableStream;
  /** Stdout override (test-only). Defaults to `process.stdout`. */
  output?: NodeJS.WritableStream;
}

/**
 * Yes/No confirmation prompt for destructive operations.
 *
 * - `--yes` short-circuits without ever touching stdin (CI-safe).
 * - In a non-interactive shell without `--yes` we refuse rather than block on a
 *   pipe; the operator explicitly opts in by passing the flag.
 * - Only `y` / `yes` (case-insensitive, trimmed) counts as yes; everything else
 *   including empty input is no.
 */
export async function promptYesNo(opts: PromptOptions): Promise<boolean> {
  if (opts.yes === true) return true;
  const tty = opts.isTTY ?? Boolean((process.stdin as { isTTY?: boolean }).isTTY);
  if (!tty) {
    throw new UserError("Refusing destructive op without --yes in a non-interactive shell.");
  }
  const rl = createInterface({
    input: opts.input ?? process.stdin,
    output: opts.output ?? process.stdout,
  });
  try {
    const answer: string = await new Promise((resolve) => {
      rl.question(`${opts.question} [y/N]: `, resolve);
    });
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    rl.close();
  }
}
