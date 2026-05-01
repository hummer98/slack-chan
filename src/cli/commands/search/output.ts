import type { OutputFormat } from "../../../config/types.ts";
import { selectFormatter } from "../../../output/format.ts";
import type { MergedHit } from "./merge.ts";

export interface SearchHitRecord {
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

export function toSearchHitRecord(hit: MergedHit): SearchHitRecord {
  return {
    team_id: hit.team_id,
    channel_id: hit.channel_id,
    ts: hit.ts,
    thread_ts: hit.thread_ts,
    user_id: hit.user_id,
    type: hit.type,
    subtype: hit.subtype,
    text: hit.text,
    edited_ts: hit.edited_ts,
    deleted: false,
    source: hit.source,
    permalink: hit.permalink,
  };
}

export interface WriteSearchOutputOpts {
  merged: MergedHit[];
  format: OutputFormat;
  stdout: NodeJS.WritableStream;
}

export function writeSearchOutput(opts: WriteSearchOutputOpts): void {
  if (opts.merged.length === 0) return;
  const records = opts.merged.map(toSearchHitRecord);
  const f = selectFormatter(opts.format);
  if (typeof f.formatBatch === "function") {
    opts.stdout.write(f.formatBatch(records));
    return;
  }
  for (const r of records) {
    opts.stdout.write(f.format(r));
  }
}
