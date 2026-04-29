export interface WorkspaceRow {
  team_id: string;
  name: string;
  url: string | null;
  default_channel: string | null;
  added_at: number;
}

export interface ChannelRow {
  team_id: string;
  channel_id: string;
  name: string | null;
  type: string | null;
  topic: string | null;
  purpose: string | null;
  is_member: number | null;
  last_synced_ts: string | null;
  fetched_at: number | null;
}

export interface MessageRow {
  team_id: string;
  channel_id: string;
  ts: string;
  thread_ts: string | null;
  user_id: string | null;
  type: string | null;
  subtype: string | null;
  text: string | null;
  edited_ts: string | null;
  readonly deleted: number;
  raw_json: string;
  fetched_at: number;
}

export type MessageUpsertInput = Omit<MessageRow, "deleted">;

export interface UserRow {
  team_id: string;
  user_id: string;
  name: string | null;
  real_name: string | null;
  email: string | null;
  profile_json: string | null;
  fetched_at: number;
}

export interface FileRow {
  team_id: string;
  file_id: string;
  channel_id: string | null;
  ts: string | null;
  name: string | null;
  mimetype: string | null;
  size: number | null;
  url_private: string | null;
  local_path: string | null;
  downloaded_at: number | null;
  raw_json: string | null;
}
