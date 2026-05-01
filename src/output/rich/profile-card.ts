import type { ColorFns } from "../ansi.ts";
import { formatRichKvList, type RichKvEntry } from "./kv-list.ts";

export interface RichProfileCard {
  handle: string;
  user_id: string;
  fields: readonly RichKvEntry[];
  /** Glyph rendered before "@handle". Empty string collapses the prefix. */
  headerGlyph: string;
}

export function formatRichProfileCard(card: RichProfileCard, colors: ColorFns): string {
  const prefix = card.headerGlyph.length > 0 ? `${card.headerGlyph} ` : "";
  const handle = colors.bold(colors.magenta(`${prefix}@${card.handle}`));
  const userId = colors.dim(`(${card.user_id})`);
  const header = `${handle}  ${userId}`;
  if (card.fields.length === 0) {
    return `${header}\n`;
  }
  const body = formatRichKvList(card.fields, colors, { indent: 2 });
  return `${header}\n${body}`;
}
