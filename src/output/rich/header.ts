import type { ColorFns } from "../ansi.ts";

/**
 * Render a section banner like "📦 Workspace: Toranomon (T9Q9BSR6C)".
 * `glyph` is rendered to the left of `title`; an empty `glyph` collapses
 * the prefix entirely. The full line is bold + magenta.
 */
export function formatRichHeader(title: string, glyph: string, colors: ColorFns): string {
  const prefix = glyph.length > 0 ? `${glyph} ` : "";
  return colors.bold(colors.magenta(`${prefix}${title}`));
}
