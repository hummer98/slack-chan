import type { ColorFns } from "../ansi.ts";
import { formatKvList, type KvEntry } from "./kv-list.ts";

export interface ProfileCard {
  handle: string;
  user_id: string;
  fields: readonly KvEntry[];
}

export function formatProfileCard(card: ProfileCard, colors: ColorFns): string {
  const header = colors.bold(`@${card.handle}  (${card.user_id})`);
  if (card.fields.length === 0) {
    return `${header}\n`;
  }
  const body = formatKvList(card.fields, colors, { indent: 2 });
  return `${header}\n${body}`;
}
