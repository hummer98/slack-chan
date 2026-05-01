import type { OutputFormat } from "../../../config/types.ts";
import { type ColorFns, isColorEnabled, isEmojiEnabled, makeColors } from "../../../output/ansi.ts";
import { selectFormatter } from "../../../output/format.ts";
import { formatProfileCard, type KvEntry } from "../../../output/human/index.ts";
import {
  formatRichProfileCard,
  getGlyphs,
  type RichGlyphs,
  type RichKvEntry,
} from "../../../output/rich/index.ts";

/**
 * The record emitted on stdout when `user` succeeds. Always `ok: true` —
 * any non-ok response from Slack is converted to a `CliError` upstream.
 *
 *   - `profile` は `UserRow.profile_json` を JSON.parse した結果 (Slack member 全体)。
 *     parse に失敗した場合 null。
 *   - `fetched_at` は unix ms。
 */
export interface UserResult {
  ok: true;
  user: {
    team_id: string;
    user_id: string;
    name: string | null;
    real_name: string | null;
    email: string | null;
    profile: unknown;
    fetched_at: number;
  };
}

interface RenderUserOpts {
  isTTY?: boolean;
  /** Override emoji detection for tests. */
  emojiEnabled?: boolean;
}

export function renderUser(
  result: UserResult,
  format: OutputFormat,
  opts: RenderUserOpts = {},
): string {
  if (format !== "human" && format !== "rich") {
    return selectFormatter(format).format(result);
  }
  const colors = makeColors(opts.isTTY === undefined ? isColorEnabled() : opts.isTTY);
  if (format === "human") {
    return renderUserHuman(result, colors);
  }
  const glyphs = getGlyphs(opts.emojiEnabled ?? isEmojiEnabled());
  return renderUserRich(result, colors, glyphs);
}

interface UserViewModel {
  handle: string;
  user_id: string;
  display_name: string | null;
  real_name: string | null;
  email: string | null;
  title: string | null;
  tz: string;
  status: string;
}

function buildUserViewModel(result: UserResult): UserViewModel {
  const u = result.user;
  const handle = u.name ?? u.user_id;
  const profile = isProfileObject(u.profile) ? u.profile : null;
  const display_name = pickString(profile, "display_name");
  const real_name = u.real_name ?? pickString(profile, "real_name");
  const email = u.email ?? pickString(profile, "email");
  const title = pickString(profile, "title");
  const tz = pickString(profile, "tz");
  const tzLabel = pickString(profile, "tz_label");
  const tzOffset = pickNumber(profile, "tz_offset");
  const status_text = pickString(profile, "status_text");
  const status_emoji = pickString(profile, "status_emoji");
  return {
    handle,
    user_id: u.user_id,
    display_name:
      display_name !== null && display_name !== handle && display_name.length > 0
        ? display_name
        : null,
    real_name,
    email,
    title,
    tz: formatTz(tz, tzLabel, tzOffset),
    status: formatStatus(status_text, status_emoji),
  };
}

export function renderUserHuman(result: UserResult, colors: ColorFns): string {
  const vm = buildUserViewModel(result);
  const fields: KvEntry[] = [];
  fields.push(kv("Real name", vm.real_name ?? "(empty)"));
  if (vm.display_name !== null) fields.push(kv("Display", vm.display_name));
  fields.push(kv("Email", vm.email ?? "(empty)"));
  fields.push(kv("Title", vm.title ?? "(empty)"));
  fields.push(kv("TZ", vm.tz));
  fields.push(kv("Status", vm.status));
  return formatProfileCard({ handle: vm.handle, user_id: vm.user_id, fields }, colors);
}

export function renderUserRich(result: UserResult, colors: ColorFns, glyphs: RichGlyphs): string {
  const vm = buildUserViewModel(result);
  const fields: RichKvEntry[] = [];
  fields.push(rkv("Real name", vm.real_name ?? "(empty)", glyphs.userRealName));
  if (vm.display_name !== null) {
    fields.push(rkv("Display", vm.display_name, glyphs.userDisplay));
  }
  fields.push(rkv("Email", vm.email ?? "(empty)", glyphs.userEmail));
  fields.push(rkv("Title", vm.title ?? "(empty)", glyphs.userTitle));
  fields.push(rkv("TZ", vm.tz, glyphs.userTz));
  fields.push(rkv("Status", vm.status, glyphs.userStatus));
  return formatRichProfileCard(
    { handle: vm.handle, user_id: vm.user_id, fields, headerGlyph: glyphs.userHeader },
    colors,
  );
}

function rkv(label: string, value: string, glyph: string): RichKvEntry {
  return { label, value, glyph };
}

function kv(label: string, value: string): KvEntry {
  return { label, value };
}

function isProfileObject(p: unknown): p is Record<string, unknown> {
  return typeof p === "object" && p !== null && !Array.isArray(p);
}

function pickString(p: Record<string, unknown> | null, key: string): string | null {
  if (p === null) return null;
  const v = p[key];
  return typeof v === "string" && v.length > 0 ? v : null;
}

function pickNumber(p: Record<string, unknown> | null, key: string): number | null {
  if (p === null) return null;
  const v = p[key];
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function formatTz(tz: string | null, label: string | null, offsetSec: number | null): string {
  if (tz === null && label === null && offsetSec === null) return "(empty)";
  const offsetPart =
    offsetSec === null ? "" : ` (UTC${offsetSec >= 0 ? "+" : ""}${Math.round(offsetSec / 3600)})`;
  if (tz !== null) return `${tz}${offsetPart}`;
  if (label !== null) return `${label}${offsetPart}`;
  return offsetPart.trim().length === 0 ? "(empty)" : offsetPart.trim();
}

function formatStatus(text: string | null, emoji: string | null): string {
  if (text === null && emoji === null) return "(empty)";
  if (text !== null && emoji !== null) return `${emoji} ${text}`;
  return text ?? emoji ?? "(empty)";
}
