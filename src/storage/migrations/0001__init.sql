CREATE TABLE workspaces (
  team_id        TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  url            TEXT,
  default_channel TEXT,
  added_at       INTEGER NOT NULL
);

CREATE TABLE channels (
  team_id        TEXT NOT NULL,
  channel_id     TEXT NOT NULL,
  name           TEXT,
  type           TEXT,
  topic          TEXT,
  purpose        TEXT,
  is_member      INTEGER,
  last_synced_ts TEXT,
  fetched_at     INTEGER,
  PRIMARY KEY (team_id, channel_id)
);

CREATE TABLE messages (
  team_id     TEXT NOT NULL,
  channel_id  TEXT NOT NULL,
  ts          TEXT NOT NULL,
  thread_ts   TEXT,
  user_id     TEXT,
  type        TEXT,
  subtype     TEXT,
  text        TEXT,
  edited_ts   TEXT,
  deleted     INTEGER DEFAULT 0,
  raw_json    TEXT NOT NULL,
  fetched_at  INTEGER NOT NULL,
  PRIMARY KEY (team_id, channel_id, ts)
);

CREATE INDEX idx_messages_thread ON messages(team_id, channel_id, thread_ts);
CREATE INDEX idx_messages_user ON messages(team_id, user_id);
CREATE INDEX idx_messages_fetched ON messages(team_id, channel_id, fetched_at);

CREATE VIRTUAL TABLE messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid'
);

CREATE TRIGGER messages_ai AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TRIGGER messages_ad AFTER DELETE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
END;

CREATE TRIGGER messages_au AFTER UPDATE ON messages BEGIN
  INSERT INTO messages_fts(messages_fts, rowid, text) VALUES('delete', old.rowid, old.text);
  INSERT INTO messages_fts(rowid, text) VALUES (new.rowid, new.text);
END;

CREATE TABLE users (
  team_id      TEXT NOT NULL,
  user_id      TEXT NOT NULL,
  name         TEXT,
  real_name    TEXT,
  email        TEXT,
  profile_json TEXT,
  fetched_at   INTEGER NOT NULL,
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE files (
  team_id     TEXT NOT NULL,
  file_id     TEXT NOT NULL,
  channel_id  TEXT,
  ts          TEXT,
  name        TEXT,
  mimetype    TEXT,
  size        INTEGER,
  url_private TEXT,
  local_path  TEXT,
  downloaded_at INTEGER,
  raw_json    TEXT,
  PRIMARY KEY (team_id, file_id)
);
