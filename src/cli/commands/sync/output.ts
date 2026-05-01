import type { SyncMode } from "../read/cache.ts";

export interface SyncResult {
  ok: true;
  team_id: string;
  channel_id: string;
  channel_name: string | null;
  mode: SyncMode;
  upserted: number;
  deleted_marked: number;
  revived: number;
  last_synced_ts: string | null;
  fetched_at: number;
}
