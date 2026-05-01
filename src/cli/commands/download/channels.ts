import type { SlackClient } from "../../../slack/client.ts";
import { UserError } from "../../errors.ts";

const CHANNEL_ID_RE = /^[CGD][A-Z0-9]{1,32}$/;
const MAX_PAGES = 20;
const PAGE_LIMIT = 1000;

interface MinimalChannel {
  id?: string;
  name?: string;
  name_normalized?: string;
}

/**
 * Resolve a `<channel>` argument to a Slack channel id. Mirrors
 * `commands/post/channels.ts` — keep both in sync until shared.
 */
export async function resolveChannel(arg: string, client: SlackClient): Promise<string> {
  if (CHANNEL_ID_RE.test(arg)) return arg;

  const target = arg.startsWith("#") ? arg.slice(1) : arg;

  let cursor: string | undefined;
  const matches: string[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = (await client.conversationsList({
      types: "public_channel,private_channel",
      exclude_archived: true,
      limit: PAGE_LIMIT,
      ...(cursor !== undefined && cursor.length > 0 ? { cursor } : {}),
    })) as {
      channels?: MinimalChannel[];
      response_metadata?: { next_cursor?: string };
    };

    const channels = Array.isArray(res.channels) ? res.channels : [];
    for (const ch of channels) {
      if (typeof ch.id !== "string") continue;
      if (ch.name === target || ch.name_normalized === target) {
        if (!matches.includes(ch.id)) matches.push(ch.id);
      }
    }

    const next = res.response_metadata?.next_cursor;
    if (typeof next !== "string" || next.length === 0) {
      if (matches.length === 0) {
        throw new UserError(
          `download: channel '${target}' not found in workspace. Try the channel ID (Cxxx) directly.`,
        );
      }
      if (matches.length === 1) {
        return matches[0] as string;
      }
      throw new UserError(
        `download: channel name '${target}' is ambiguous (matches ${matches.join(", ")}). ` +
          "Pass the channel ID directly.",
      );
    }
    cursor = next;
  }
  throw new UserError(
    "download: workspace has too many channels to scan; pass channel ID (Cxxx) directly.",
  );
}
