import { describe, expect, it } from "bun:test";
import { join } from "node:path";

const REPO_ROOT = join(import.meta.dir, "..", "..");

async function spawnReleaseScript(args: readonly string[]): Promise<{
  exitCode: number;
  stdout: string;
  stderr: string;
}> {
  const proc = Bun.spawn(["bash", "scripts/release.sh", ...args], {
    cwd: REPO_ROOT,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, SLACK_CHAN_RELEASE_SKIP_GIT_CHECKS: "1" },
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const exitCode = await proc.exited;
  return { exitCode, stdout, stderr };
}

describe("scripts/release.sh --dry-run", () => {
  it("exits 0 with a valid version", async () => {
    const { exitCode, stdout } = await spawnReleaseScript(["--dry-run", "0.1.0"]);
    expect(exitCode).toBe(0);
    expect(stdout.length).toBeGreaterThan(0);
  });

  it("prints 'would tag v0.1.0' in stdout", async () => {
    const { stdout } = await spawnReleaseScript(["--dry-run", "0.1.0"]);
    expect(stdout).toMatch(/would tag v0\.1\.0/);
  });

  it("prints 'would commit' in stdout", async () => {
    const { stdout } = await spawnReleaseScript(["--dry-run", "0.1.0"]);
    expect(stdout).toMatch(/would commit/);
  });

  it("prints 'would push' in stdout", async () => {
    const { stdout } = await spawnReleaseScript(["--dry-run", "0.1.0"]);
    expect(stdout).toMatch(/would push/);
  });

  it("rejects an invalid version with non-zero exit", async () => {
    const { exitCode, stderr } = await spawnReleaseScript(["--dry-run", "not-semver"]);
    expect(exitCode).not.toBe(0);
    expect(stderr).toMatch(/version/i);
  });

  it("does not modify CHANGELOG.md or package.json on dry-run", async () => {
    const changelogBefore = await Bun.file(join(REPO_ROOT, "CHANGELOG.md")).text();
    const pkgBefore = await Bun.file(join(REPO_ROOT, "package.json")).text();
    await spawnReleaseScript(["--dry-run", "9.9.9"]);
    const changelogAfter = await Bun.file(join(REPO_ROOT, "CHANGELOG.md")).text();
    const pkgAfter = await Bun.file(join(REPO_ROOT, "package.json")).text();
    expect(changelogAfter).toBe(changelogBefore);
    expect(pkgAfter).toBe(pkgBefore);
  });
});
