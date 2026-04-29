import type { MessageRow } from "../../../storage/types.ts";
import type { RemoteSearchHit } from "./remote.ts";

export interface MergeInput {
  team_id: string;
  fts: MessageRow[];
  remote: RemoteSearchHit[];
  limit: number;
}

export interface MergedHit {
  team_id: string;
  channel_id: string;
  ts: string;
  thread_ts: string | null;
  user_id: string | null;
  type: string | null;
  subtype: string | null;
  text: string | null;
  edited_ts: string | null;
  deleted: false;
  source: "cache" | "remote" | "both";
  permalink: string | null;
}

function key(channel_id: string, ts: string): string {
  return `${channel_id}:${ts}`;
}

function fromCache(team_id: string, row: MessageRow): MergedHit {
  return {
    team_id,
    channel_id: row.channel_id,
    ts: row.ts,
    thread_ts: row.thread_ts,
    user_id: row.user_id,
    type: row.type,
    subtype: row.subtype,
    text: row.text,
    edited_ts: row.edited_ts,
    deleted: false,
    source: "cache",
    permalink: null,
  };
}

function fromRemote(team_id: string, hit: RemoteSearchHit): MergedHit {
  return {
    team_id,
    channel_id: hit.channel_id,
    ts: hit.ts,
    thread_ts: null,
    user_id: hit.user_id,
    type: null,
    subtype: null,
    text: hit.text,
    edited_ts: null,
    deleted: false,
    source: "remote",
    permalink: hit.permalink,
  };
}

export function mergeHits(input: MergeInput): MergedHit[] {
  const map = new Map<string, MergedHit>();

  for (const row of input.fts) {
    map.set(key(row.channel_id, row.ts), fromCache(input.team_id, row));
  }

  for (const hit of input.remote) {
    const k = key(hit.channel_id, hit.ts);
    const existing = map.get(k);
    if (existing === undefined) {
      map.set(k, fromRemote(input.team_id, hit));
    } else {
      map.set(k, {
        ...existing,
        source: "both",
        permalink: hit.permalink ?? existing.permalink,
      });
    }
  }

  const merged = Array.from(map.values());
  merged.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));
  return merged.slice(0, input.limit);
}
