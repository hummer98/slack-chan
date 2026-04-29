import { describe, expect, it } from "bun:test";
import {
  CliError,
  InternalError,
  TransientError,
  toCliError,
  UserError,
} from "../../src/cli/errors.ts";
import {
  EXIT_INTERNAL,
  EXIT_OK,
  EXIT_TRANSIENT,
  EXIT_USER_ERROR,
} from "../../src/cli/exit-codes.ts";

describe("exit codes", () => {
  it("are 0/1/2/3", () => {
    expect(EXIT_OK).toBe(0);
    expect(EXIT_USER_ERROR).toBe(1);
    expect(EXIT_TRANSIENT).toBe(2);
    expect(EXIT_INTERNAL).toBe(3);
  });
});

describe("CliError hierarchy", () => {
  it("UserError exitCode = 1", () => {
    const e = new UserError("bad flag");
    expect(e).toBeInstanceOf(CliError);
    expect(e).toBeInstanceOf(UserError);
    expect(e.exitCode).toBe(EXIT_USER_ERROR);
    expect(e.message).toBe("bad flag");
    expect(e.name).toBe("UserError");
  });

  it("TransientError exitCode = 2", () => {
    const e = new TransientError("rate limited");
    expect(e).toBeInstanceOf(CliError);
    expect(e.exitCode).toBe(EXIT_TRANSIENT);
    expect(e.name).toBe("TransientError");
  });

  it("InternalError exitCode = 3", () => {
    const e = new InternalError("bug");
    expect(e).toBeInstanceOf(CliError);
    expect(e.exitCode).toBe(EXIT_INTERNAL);
    expect(e.name).toBe("InternalError");
  });
});

describe("toCliError", () => {
  it("(A) returns CliError instances by identity", () => {
    const e = new UserError("x");
    expect(toCliError(e)).toBe(e);
    const t = new TransientError("y");
    expect(toCliError(t)).toBe(t);
  });

  it("(B) wraps generic Error as InternalError(3)", () => {
    const e = new Error("boom");
    const out = toCliError(e);
    expect(out).toBeInstanceOf(InternalError);
    expect(out.exitCode).toBe(EXIT_INTERNAL);
    expect(out.message).toBe("boom");
  });

  it("(C) wraps string as InternalError", () => {
    const out = toCliError("oops");
    expect(out).toBeInstanceOf(InternalError);
    expect(out.message).toBe("oops");
  });

  it("(D) wraps arbitrary object as InternalError with JSON message", () => {
    const out = toCliError({ code: 42 });
    expect(out).toBeInstanceOf(InternalError);
    expect(out.message).toContain("42");
  });
});
