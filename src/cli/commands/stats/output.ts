import type { OutputFormat } from "../../../config/types.ts";
import { type ColorFns, isColorEnabled, makeColors } from "../../../output/ansi.ts";
import { selectFormatter } from "../../../output/format.ts";
import {
  formatKvList,
  formatLocalTimestamp,
  humanBytes,
  humanRelativeTime,
  type KvEntry,
} from "../../../output/human/index.ts";

export interface StatsRecord {
  team_id: string;
  name: string;
  channels_total: number;
  channels_member: number;
  messages_total: number;
  messages_alive: number;
  users: number;
  files: number;
  last_synced_ts: string | null;
  db_size_bytes: number;
}

interface RenderStatsOpts {
  isTTY?: boolean;
  /** Required when format === "human". now in ms — used for relative time. */
  now_ms?: number;
  /** IANA tz for human timestamp display. Defaults to system local. */
  tz?: string;
}

export function renderStats(
  rec: StatsRecord,
  format: OutputFormat,
  opts: RenderStatsOpts = {},
): string {
  if (format !== "human") {
    return selectFormatter(format).format(rec);
  }
  const colors = makeColors(opts.isTTY === undefined ? isColorEnabled() : opts.isTTY);
  return renderStatsHuman(rec, colors, {
    now_ms: opts.now_ms ?? Date.now(),
    tz: opts.tz ?? defaultTz(),
  });
}

export function renderStatsHuman(
  rec: StatsRecord,
  colors: ColorFns,
  opts: { now_ms: number; tz: string },
): string {
  const header = `${colors.bold("Workspace")}: ${rec.name} (${rec.team_id})`;
  const fields: KvEntry[] = [];
  fields.push(kv("Channels", `${rec.channels_total} (member: ${rec.channels_member})`));
  fields.push(kv("Messages", `${rec.messages_total} (alive: ${rec.messages_alive})`));
  fields.push(kv("Users", String(rec.users)));
  fields.push(kv("Files", String(rec.files)));
  fields.push(kv("Last sync", formatLastSync(rec.last_synced_ts, opts)));
  fields.push(kv("DB size", humanBytes(rec.db_size_bytes)));
  return `${header}\n${formatKvList(fields, colors, { indent: 2 })}`;
}

function kv(label: string, value: string): KvEntry {
  return { label, value };
}

function formatLastSync(ts: string | null, opts: { now_ms: number; tz: string }): string {
  if (ts === null) return "(never)";
  const sec = Number.parseFloat(ts);
  if (!Number.isFinite(sec)) return "(invalid)";
  const local = formatLocalTimestamp(ts, opts.tz);
  const rel = humanRelativeTime(opts.now_ms, sec * 1000);
  return `${local} (${rel})`;
}

function defaultTz(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}
