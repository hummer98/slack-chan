import { redactSecrets } from "../slack/redact.ts";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface Logger {
  debug(...args: unknown[]): void;
  info(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  error(...args: unknown[]): void;
  setLevel(level: LogLevel): void;
}

const LEVEL_ORDER: readonly LogLevel[] = ["debug", "info", "warn", "error"];

function isErrorLikePlainObject(
  v: unknown,
): v is { name: string; message: string; stack?: string } {
  if (v === null || typeof v !== "object" || Array.isArray(v)) {
    return false;
  }
  if (v instanceof Error) {
    return true;
  }
  const r = v as Record<string, unknown>;
  return typeof r.name === "string" && typeof r.message === "string";
}

function serializeArg(v: unknown): string {
  if (typeof v === "string") {
    return v;
  }
  if (isErrorLikePlainObject(v)) {
    const stack = (v as { stack?: unknown }).stack;
    if (typeof stack === "string" && stack.length > 0) {
      return `${v.name}: ${v.message}\n${stack}`;
    }
    return `${v.name}: ${v.message}`;
  }
  if (typeof v === "object" && v !== null) {
    try {
      return JSON.stringify(v);
    } catch {
      return String(v);
    }
  }
  return String(v);
}

export class StderrLogger implements Logger {
  private level: LogLevel = "info";

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  debug(...args: unknown[]): void {
    if (this.isDebugEnabled()) {
      this.write("debug", args);
    }
  }

  info(...args: unknown[]): void {
    if (this.isEnabled("info")) {
      this.write("info", args);
    }
  }

  warn(...args: unknown[]): void {
    if (this.isEnabled("warn")) {
      this.write("warn", args);
    }
  }

  error(...args: unknown[]): void {
    if (this.isEnabled("error")) {
      this.write("error", args);
    }
  }

  private isEnabled(level: LogLevel): boolean {
    return LEVEL_ORDER.indexOf(level) >= LEVEL_ORDER.indexOf(this.level);
  }

  private isDebugEnabled(): boolean {
    if (this.level === "debug") return true;
    const v = process.env.SLACK_CHAN_DEBUG;
    return v === "1" || v === "true";
  }

  private write(level: LogLevel, args: unknown[]): void {
    const redacted = args.map((a) => redactSecrets(a));
    const serialized = redacted.map(serializeArg).join(" ");
    process.stderr.write(`[slack-chan] ${level} ${serialized}\n`);
  }
}
