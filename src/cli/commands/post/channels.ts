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
 * Resolve a `<channel>` argument to a Slack channel id.
 *
 *   - `Cxxx` / `Gxxx` / `Dxxx` is returned as-is (no API call).
 *   - `#name` / `name` is resolved by paginating `conversations.list` over
 *     `public_channel,private_channel`. All pages are scanned (Slack returns
 *     pages in non-deterministic order, so the first page hit can be wrong
 *     when public + private share a name).
 *
 * Throws `UserError` on:
 *   - 0 matches (channel doesn't exist or the bot can't see it)
 *   - 2+ matches (ambiguous; ID disambiguation required)
 *   - >20 pages scanned (workspace too big — pass ID directly)
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
      // pagination ended naturally
      if (matches.length === 0) {
        throw new UserError(
          `post: channel '${target}' not found in workspace. Try the channel ID (Cxxx) directly.`,
        );
      }
      if (matches.length === 1) {
        return matches[0] as string;
      }
      throw new UserError(
        `post: channel name '${target}' is ambiguous (matches ${matches.join(", ")}). ` +
          "Pass the channel ID directly.",
      );
    }
    cursor = next;
  }
  throw new UserError(
    "post: workspace has too many channels to scan; pass channel ID (Cxxx) directly.",
  );
}
