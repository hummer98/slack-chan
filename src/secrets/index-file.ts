import { randomBytes } from "node:crypto";
import {
  chmod,
  lstat,
  mkdir,
  open as openFile,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { dirname, join } from "node:path";

/**
 * Slack `team_id` format. `T` prefix + uppercase alphanumerics, length 1..32.
 *
 * Validating at backend entry points blocks two classes of bug:
 *   1. argument injection into `security` (a leading `-` would be parsed
 *      as a flag by the macOS Keychain CLI).
 *   2. garbage strings flowing into the index / tokens files.
 */
const TEAM_ID_RE = /^T[A-Z0-9]{1,32}$/;

export function assertValidTeamId(team_id: unknown): asserts team_id is string {
  if (typeof team_id !== "string" || !TEAM_ID_RE.test(team_id)) {
    throw new Error("Invalid Slack team_id format (expected /^T[A-Z0-9]{1,32}$/)");
  }
}

const INDEX_FILENAME = "index.json";
export const TOKENS_FILENAME = "tokens.json";
const STALE_TEMPFILE_AGE_MS = 24 * 60 * 60 * 1000;
const TEMPFILE_RE = /^(?:index|tokens)\.json\.[^/]+\.tmp$/;

/**
 * Verify that a path component is not a symlink, mitigating local symlink
 * attacks on the secrets dir (M1). Also exposes the underlying `lstat`
 * result for callers that want the mode bits.
 */
async function lstatNoFollow(path: string) {
  return lstat(path);
}

function assertNoSymlink(stats: { isSymbolicLink: () => boolean }, path: string): void {
  if (stats.isSymbolicLink()) {
    throw new Error(
      `${path} is a symlink and cannot be trusted; remove the symlink and \`chmod 600\` the original file.`,
    );
  }
}

function assertModeFile(modeBits: number, path: string): void {
  if ((modeBits & 0o077) !== 0) {
    throw new Error(
      `${path} has unsafe permissions (group/other access). Run \`chmod 600 ${path}\` and retry.`,
    );
  }
}

function assertModeDir(modeBits: number, path: string): void {
  if ((modeBits & 0o077) !== 0) {
    throw new Error(
      `${path} has unsafe permissions (group/other access). Run \`chmod 700 ${path}\` and retry.`,
    );
  }
}

/**
 * Ensure the parent dir exists with mode 0700. Reused by writers when the
 * config dir has not been created yet.
 */
async function ensureSecureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const s = await lstatNoFollow(dir);
  assertNoSymlink(s, dir);
  if (!s.isDirectory()) {
    throw new Error(`${dir} is not a directory.`);
  }
  // Insurance against umask / pre-existing dir.
  if ((s.mode & 0o777) !== 0o700) {
    await chmod(dir, 0o700);
  }
}

/**
 * Inspect an existing file for parse-error fail-closed (M2). Used by the
 * write path: we MUST refuse to overwrite damaged user data, but we MUST
 * NOT enforce file mode on the existing file (the writer is about to
 * replace it with a fresh chmod-600 copy).
 */
async function assertExistingJsonIsParseable(filePath: string): Promise<void> {
  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
  try {
    JSON.parse(raw);
  } catch {
    throw new Error(
      `${filePath} contains invalid JSON. Refusing to read or overwrite (fail-closed). Inspect/back up the file, then delete it to re-initialize.`,
    );
  }
}

/**
 * Read a `chmod 600` JSON file from a `chmod 700` parent dir.
 *
 * - Returns `undefined` if the file does not exist (first-run case).
 * - Throws on symlink, on bad permissions, and on JSON parse error
 *   (fail-closed, M2: never silently overwrite damaged user data).
 */
export async function readSecureJson<T>(filePath: string): Promise<T | undefined> {
  const dir = dirname(filePath);
  // Parent dir checks: must not be a symlink, must be 700.
  let dirStat: Awaited<ReturnType<typeof lstat>>;
  try {
    dirStat = await lstatNoFollow(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
  assertNoSymlink(dirStat, dir);
  if (!dirStat.isDirectory()) {
    throw new Error(`${dir} is not a directory.`);
  }
  assertModeDir(dirStat.mode, dir);

  let fileStat: Awaited<ReturnType<typeof lstat>>;
  try {
    fileStat = await lstatNoFollow(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return undefined;
    }
    throw err;
  }
  assertNoSymlink(fileStat, filePath);
  if (!fileStat.isFile()) {
    throw new Error(`${filePath} is not a regular file.`);
  }
  assertModeFile(fileStat.mode, filePath);

  const fd = await openFile(filePath, "r");
  let raw: string;
  try {
    raw = await fd.readFile({ encoding: "utf8" });
  } finally {
    await fd.close();
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    // Fail-closed (M2). Never include `raw` in the error message — the file
    // could contain a partially-written token. Surface only the path.
    throw new Error(
      `${filePath} contains invalid JSON. Refusing to read or overwrite (fail-closed). Inspect/back up the file, then delete it to re-initialize.`,
    );
  }
}

/**
 * Atomic JSON writer with chmod 600 enforcement.
 *
 * - mkdir -p the parent (mode 0700) if missing.
 * - tempfile in the same dir, opened `O_WRONLY | O_CREAT | O_EXCL` mode 0600.
 * - fsync, close, rename, then re-chmod 600 (umask insurance).
 * - Refuses to write if either the parent or the destination is a symlink
 *   (M1), or if the existing destination contains invalid JSON (M2).
 */
export async function writeSecureJson(filePath: string, value: unknown): Promise<void> {
  const dir = dirname(filePath);
  await ensureSecureDir(dir);

  // Symlink check on destination, if it already exists.
  try {
    const existing = await lstatNoFollow(filePath);
    assertNoSymlink(existing, filePath);
    if (!existing.isFile()) {
      throw new Error(`${filePath} is not a regular file.`);
    }
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
  }

  // Fail-closed (M2): do NOT clobber a damaged user file.
  await assertExistingJsonIsParseable(filePath);

  await cleanupStaleTempFiles(dir);

  const tmpName = `${filePath.split("/").pop()}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const tmpPath = join(dir, tmpName);
  // String flag "wx" = O_WRONLY | O_CREAT | O_EXCL (cross-platform).
  const fd = await openFile(tmpPath, "wx", 0o600);
  let renamed = false;
  try {
    await fd.writeFile(JSON.stringify(value));
    await fd.sync();
    await fd.close();

    // TOCTOU re-check: if anything substituted a symlink between the
    // first lstat and the rename, refuse.
    try {
      const recheck = await lstatNoFollow(filePath);
      assertNoSymlink(recheck, filePath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    await rename(tmpPath, filePath);
    renamed = true;
    // Insurance: ensure mode 0o600 regardless of umask or stale destination.
    await chmod(filePath, 0o600);
  } finally {
    if (!renamed) {
      await unlink(tmpPath).catch(() => {});
    }
  }
}

/**
 * Read the team_id index. Returns `[]` when the file does not exist (first
 * run). Validates each entry against the team_id format on the way out so
 * downstream callers cannot be tricked by a hand-edited file.
 */
export async function readIndex(dir: string): Promise<string[]> {
  const path = join(dir, INDEX_FILENAME);
  const data = await readSecureJson<unknown>(path);
  if (data === undefined) return [];
  if (!Array.isArray(data) || !data.every((x): x is string => typeof x === "string")) {
    throw new Error(`${path} is not in the expected shape (array of team_ids). Refusing to read.`);
  }
  for (const id of data) assertValidTeamId(id);
  return data;
}

/**
 * Persist the team_id index. Each id is validated; the file is written
 * atomically with mode 0600 and the parent dir is forced to 0700.
 */
export async function writeIndex(dir: string, ids: readonly string[]): Promise<void> {
  for (const id of ids) assertValidTeamId(id);
  const path = join(dir, INDEX_FILENAME);
  await writeSecureJson(path, ids);
}

/**
 * Best-effort cleanup of stale `tokens.json.<pid>.<rand>.tmp` /
 * `index.json.<pid>.<rand>.tmp` files left behind by a crashed process
 * (kill -9, power loss). Files newer than 24h are kept so we never delete
 * a tempfile that another instance is currently writing (M3).
 */
export async function cleanupStaleTempFiles(dir: string): Promise<void> {
  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    return;
  }
  const cutoff = Date.now() - STALE_TEMPFILE_AGE_MS;
  for (const name of entries) {
    if (!TEMPFILE_RE.test(name)) continue;
    const full = join(dir, name);
    try {
      const s = await stat(full);
      if (s.mtimeMs < cutoff) {
        await rm(full, { force: true });
      }
    } catch {
      // best-effort, ignore.
    }
  }
}
