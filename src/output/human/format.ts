// Zero-dep human-friendly formatters for numbers and timestamps.

const KIB = 1024;
const MIB = 1024 * 1024;
const GIB = 1024 * 1024 * 1024;
const TIB = 1024 * 1024 * 1024 * 1024;

export function humanBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  if (n < KIB) return `${Math.round(n)} B`;
  if (n < MIB) return `${(n / KIB).toFixed(1)} KiB`;
  if (n < GIB) return `${(n / MIB).toFixed(1)} MiB`;
  if (n < TIB) return `${(n / GIB).toFixed(1)} GiB`;
  return `${(n / TIB).toFixed(1)} TiB`;
}

const SEC = 1000;
const MIN = 60 * SEC;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

export function humanRelativeTime(now_ms: number, then_ms: number): string {
  const diff = now_ms - then_ms;
  if (diff < 5 * SEC) return "just now";
  if (diff < MIN) return `${Math.floor(diff / SEC)} seconds ago`;
  if (diff < 2 * MIN) return "1 minute ago";
  if (diff < HOUR) return `${Math.floor(diff / MIN)} minutes ago`;
  if (diff < 2 * HOUR) return "1 hour ago";
  if (diff < DAY) return `${Math.floor(diff / HOUR)} hours ago`;
  if (diff < 2 * DAY) return "1 day ago";
  if (diff < MONTH) return `${Math.floor(diff / DAY)} days ago`;
  if (diff < 2 * MONTH) return "1 month ago";
  if (diff < YEAR) return `${Math.floor(diff / MONTH)} months ago`;
  if (diff < 2 * YEAR) return "1 year ago";
  return `${Math.floor(diff / YEAR)} years ago`;
}

/**
 * Format Slack `ts` (or epoch ms) into "YYYY-MM-DD HH:MM:SS" in the given IANA timezone.
 * The `tz` argument is required to avoid relying on `process.env.TZ` mutation,
 * which is unreliable across platforms (see ADR-0013 §7).
 */
export function formatLocalTimestamp(ts: string | number, tz: string): string {
  let ms: number;
  if (typeof ts === "string") {
    const sec = Number.parseFloat(ts);
    if (!Number.isFinite(sec)) return "invalid date";
    ms = Math.floor(sec * 1000);
  } else {
    ms = Math.floor(ts);
  }
  const date = new Date(ms);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const y = get("year");
  const mo = get("month");
  const d = get("day");
  let h = get("hour");
  if (h === "24") h = "00"; // some locales emit "24" for midnight
  const mi = get("minute");
  const s = get("second");
  return `${y}-${mo}-${d} ${h}:${mi}:${s}`;
}
