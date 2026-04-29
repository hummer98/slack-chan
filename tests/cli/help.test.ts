import { describe, expect, it } from "bun:test";
import pkg from "../../package.json" with { type: "json" };
import { COMMAND_NAMES } from "../../src/cli/commands/index.ts";
import { buildTopLevelHelp } from "../../src/cli/help.ts";

describe("buildTopLevelHelp", () => {
  it("contains all 10 subcommand names", () => {
    const text = buildTopLevelHelp();
    for (const name of COMMAND_NAMES) {
      expect(text).toContain(name);
    }
  });

  it("contains the package version", () => {
    const text = buildTopLevelHelp();
    expect(text).toContain(pkg.version);
  });

  it("documents the global flags", () => {
    const text = buildTopLevelHelp();
    expect(text).toContain("--workspace");
    expect(text).toContain("--json");
    expect(text).toContain("--toon");
    expect(text).toContain("--human");
    expect(text).toContain("--verbose");
    expect(text).toContain("--help");
    expect(text).toContain("--version");
  });
});
