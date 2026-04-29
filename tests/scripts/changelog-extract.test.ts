import { describe, expect, it } from "bun:test";

/**
 * Same awk script used by .github/workflows/release.yml and
 * scripts/release.sh to extract a single version section from
 * CHANGELOG.md (Keep a Changelog format).
 *
 * The script:
 *   1. waits for a `## [VERSION]` heading, sets `found=1`, skips that line
 *   2. exits when it sees the next `## [` heading
 *   3. prints every line in between
 */
function buildAwkScript(version: string): string {
  return `/^## \\[${version}\\]/{found=1; next} /^## \\[/{if(found) exit} found`;
}

async function extractSection(version: string, changelog: string): Promise<string> {
  const proc = Bun.spawn(["awk", buildAwkScript(version)], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });
  proc.stdin.write(changelog);
  await proc.stdin.end();
  const [stdout] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
  return stdout;
}

const FIXTURE = `# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- something new under development

## [0.2.0] - 2026-05-15

### Added

- second release feature A
- second release feature B

### Fixed

- second release fix

## [0.1.0] - 2026-04-29

### Added

- initial release feature

## [0.0.0] - 2026-04-01

### Added

- placeholder
`;

describe("CHANGELOG awk extraction (release.yml / release.sh shared)", () => {
  it("extracts the [0.2.0] section without surrounding headings", async () => {
    const out = await extractSection("0.2.0", FIXTURE);
    expect(out).toContain("- second release feature A");
    expect(out).toContain("- second release feature B");
    expect(out).toContain("- second release fix");
    expect(out).not.toContain("## [0.2.0]");
    expect(out).not.toContain("## [0.1.0]");
    expect(out).not.toContain("## [Unreleased]");
  });

  it("extracts the [0.1.0] section between [0.2.0] and [0.0.0]", async () => {
    const out = await extractSection("0.1.0", FIXTURE);
    expect(out).toContain("- initial release feature");
    expect(out).not.toContain("- placeholder");
    expect(out).not.toContain("- second release feature A");
  });

  it("extracts the [Unreleased] section", async () => {
    const out = await extractSection("Unreleased", FIXTURE);
    expect(out).toContain("- something new under development");
    expect(out).not.toContain("## [0.2.0]");
  });

  it("returns empty for a version that is absent from the changelog", async () => {
    const out = await extractSection("9.9.9", FIXTURE);
    expect(out.trim()).toBe("");
  });
});
