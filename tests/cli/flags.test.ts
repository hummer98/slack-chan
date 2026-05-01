import { describe, expect, it } from "bun:test";
import { UserError } from "../../src/cli/errors.ts";
import { parseGlobalFlags } from "../../src/cli/flags.ts";

describe("parseGlobalFlags", () => {
  it("(1) --json before subcommand: format=jsonl, sub=read, rest=[foo]", () => {
    const r = parseGlobalFlags(["--json", "read", "foo"]);
    expect(r.global.format).toBe("jsonl");
    expect(r.subcommand).toBe("read");
    expect(r.rest).toEqual(["foo"]);
  });

  it("(2) --human after subcommand still parsed as global", () => {
    const r = parseGlobalFlags(["read", "foo", "--human"]);
    expect(r.global.format).toBe("human");
    expect(r.subcommand).toBe("read");
    expect(r.rest).toEqual(["foo"]);
  });

  it("(3) --json + --human is mutually exclusive (UserError)", () => {
    expect(() => parseGlobalFlags(["--json", "--human"])).toThrow(UserError);
  });

  it("(3b) --json + --toon is mutually exclusive", () => {
    expect(() => parseGlobalFlags(["--json", "--toon", "read"])).toThrow(/mutually exclusive/);
  });

  it("(4a) --workspace=T123 inline form", () => {
    const r = parseGlobalFlags(["--workspace=T123", "read"]);
    expect(r.global.workspace).toBe("T123");
    expect(r.subcommand).toBe("read");
    expect(r.rest).toEqual([]);
  });

  it("(4b) --workspace T123 space-separated form (consumes next arg)", () => {
    const r = parseGlobalFlags(["--workspace", "T123", "read", "foo"]);
    expect(r.global.workspace).toBe("T123");
    expect(r.subcommand).toBe("read");
    expect(r.rest).toEqual(["foo"]);
  });

  it("(5) --verbose sets verbose=true", () => {
    const r = parseGlobalFlags(["--verbose", "read"]);
    expect(r.global.verbose).toBe(true);
  });

  it("(6) --help sets help=true and subcommand=null", () => {
    const r = parseGlobalFlags(["--help"]);
    expect(r.global.help).toBe(true);
    expect(r.subcommand).toBeNull();
    expect(r.rest).toEqual([]);
  });

  it("(7) --version sets version=true", () => {
    const r = parseGlobalFlags(["--version"]);
    expect(r.global.version).toBe(true);
  });

  it("(8) default format is jsonl when no format flag", () => {
    const r = parseGlobalFlags(["read"]);
    expect(r.global.format).toBe("jsonl");
  });

  it("(9) subcommand-specific flags pass through to rest", () => {
    const r = parseGlobalFlags(["read", "--limit=10", "--json"]);
    expect(r.global.format).toBe("jsonl");
    expect(r.subcommand).toBe("read");
    expect(r.rest).toEqual(["--limit=10"]);
  });

  it("(9b) space-separated subcommand flags pass through unchanged", () => {
    const r = parseGlobalFlags(["read", "--limit", "10"]);
    expect(r.subcommand).toBe("read");
    expect(r.rest).toEqual(["--limit", "10"]);
  });

  it("(10) empty args: subcommand=null, no flags set", () => {
    const r = parseGlobalFlags([]);
    expect(r.subcommand).toBeNull();
    expect(r.rest).toEqual([]);
    expect(r.global.help).toBe(false);
    expect(r.global.workspace).toBeNull();
  });

  it("(11) -h short form sets help", () => {
    const r = parseGlobalFlags(["-h"]);
    expect(r.global.help).toBe(true);
  });

  it("(12) -v short form sets version", () => {
    const r = parseGlobalFlags(["-v"]);
    expect(r.global.version).toBe(true);
  });

  it("(13) global flags interleaved before/after subcommand", () => {
    const r = parseGlobalFlags(["--workspace=T1", "read", "--json", "foo"]);
    expect(r.global.workspace).toBe("T1");
    expect(r.global.format).toBe("jsonl");
    expect(r.subcommand).toBe("read");
    expect(r.rest).toEqual(["foo"]);
  });

  it("(14) --rich sets format=rich", () => {
    const r = parseGlobalFlags(["--rich", "read"]);
    expect(r.global.format).toBe("rich");
    expect(r.subcommand).toBe("read");
  });

  it("(14b) --rich + --human is mutually exclusive", () => {
    expect(() => parseGlobalFlags(["--rich", "--human"])).toThrow(/mutually exclusive/);
  });

  it("(14c) --rich + --json is mutually exclusive", () => {
    expect(() => parseGlobalFlags(["--rich", "--json"])).toThrow(/mutually exclusive/);
  });
});
