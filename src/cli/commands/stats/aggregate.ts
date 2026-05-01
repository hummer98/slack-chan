import type { Database } from "bun:sqlite";
import * as channelsDao from "../../../storage/dao/channels.ts";
import * as filesDao from "../../../storage/dao/files.ts";
import * as messagesDao from "../../../storage/dao/messages.ts";
import * as usersDao from "../../../storage/dao/users.ts";
import type { WorkspaceRow } from "../../../storage/types.ts";
import type { StatsRecord } from "./output.ts";

export function aggregateWorkspace(db: Database, ws: WorkspaceRow, dbBytes: number): StatsRecord {
  return {
    team_id: ws.team_id,
    name: ws.name,
    channels_total: channelsDao.countByTeam(db, ws.team_id),
    channels_member: channelsDao.countByTeam(db, ws.team_id, { is_member: 1 }),
    messages_total: messagesDao.countByTeam(db, ws.team_id, { includeDeleted: true }),
    messages_alive: messagesDao.countByTeam(db, ws.team_id),
    users: usersDao.count(db, ws.team_id),
    files: filesDao.countByTeam(db, ws.team_id),
    last_synced_ts: channelsDao.maxLastSyncedTs(db, ws.team_id),
    db_size_bytes: dbBytes,
  };
}
