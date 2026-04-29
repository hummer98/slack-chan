import { EXIT_INTERNAL, EXIT_TRANSIENT, EXIT_USER_ERROR, type ExitCode } from "./exit-codes.ts";

export class CliError extends Error {
  readonly exitCode: ExitCode;
  constructor(message: string, exitCode: ExitCode) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export class UserError extends CliError {
  constructor(message: string) {
    super(message, EXIT_USER_ERROR);
    this.name = "UserError";
  }
}

export class TransientError extends CliError {
  constructor(message: string) {
    super(message, EXIT_TRANSIENT);
    this.name = "TransientError";
  }
}

export class InternalError extends CliError {
  constructor(message: string) {
    super(message, EXIT_INTERNAL);
    this.name = "InternalError";
  }
}

/**
 * Normalize unknown thrown values into a `CliError`. `CliError` instances
 * pass through; everything else is wrapped as `InternalError` so the runCli
 * top-level catch always has a stable shape (message + exitCode).
 */
export function toCliError(err: unknown): CliError {
  if (err instanceof CliError) {
    return err;
  }
  if (err instanceof Error) {
    return new InternalError(err.message);
  }
  if (typeof err === "string") {
    return new InternalError(err);
  }
  try {
    return new InternalError(JSON.stringify(err));
  } catch {
    return new InternalError(String(err));
  }
}
