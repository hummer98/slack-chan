// Glyph table for ADR-0014 `--rich`. When emoji is disabled (SLACK_CHAN_NO_EMOJI
// or non-TTY), GLYPHS_OFF replaces decorative pictographs with empty strings
// (or the same ASCII fallback used by `--human`) so the layout collapses cleanly.

export interface RichGlyphs {
  workspaceHeader: string;
  workspaceListHeader: string;
  statsChannels: string;
  statsMessages: string;
  statsUsers: string;
  statsFiles: string;
  statsLastSync: string;
  statsDbSize: string;
  userHeader: string;
  userRealName: string;
  userDisplay: string;
  userEmail: string;
  userTitle: string;
  userTz: string;
  userStatus: string;
  threadIndicator: string;
  dateHeader: string;
  downloadOk: string;
  downloadSkipped: string;
}

const GLYPHS_ON: RichGlyphs = {
  workspaceHeader: "📦",
  workspaceListHeader: "🏢",
  statsChannels: "💬",
  statsMessages: "📝",
  statsUsers: "👥",
  statsFiles: "📁",
  statsLastSync: "🕐",
  statsDbSize: "💾",
  userHeader: "👤",
  userRealName: "🪪",
  userDisplay: "🏷️",
  userEmail: "📧",
  userTitle: "💼",
  userTz: "🌏",
  userStatus: "💭",
  threadIndicator: "🧵",
  dateHeader: "📅",
  downloadOk: "✅",
  downloadSkipped: "↺",
};

const GLYPHS_OFF: RichGlyphs = {
  workspaceHeader: "",
  workspaceListHeader: "",
  statsChannels: "",
  statsMessages: "",
  statsUsers: "",
  statsFiles: "",
  statsLastSync: "",
  statsDbSize: "",
  userHeader: "",
  userRealName: "",
  userDisplay: "",
  userEmail: "",
  userTitle: "",
  userTz: "",
  userStatus: "",
  threadIndicator: "⤷ thread",
  dateHeader: "",
  downloadOk: "✓",
  downloadSkipped: "↺",
};

export function getGlyphs(emojiEnabled: boolean): RichGlyphs {
  return emojiEnabled ? GLYPHS_ON : GLYPHS_OFF;
}
