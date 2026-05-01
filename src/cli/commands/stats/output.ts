export interface StatsRecord {
  team_id: string;
  name: string;
  channels_total: number;
  channels_member: number;
  messages_total: number;
  messages_alive: number;
  users: number;
  files: number;
  last_synced_ts: string | null;
  db_size_bytes: number;
}
