-- T025 / ADR-0012: messages_fts を builtin trigram tokenizer に切り替え
-- forward-only。rollback 不要。`DROP TABLE IF EXISTS` で冪等性を担保。

DROP TABLE IF EXISTS messages_fts;

CREATE VIRTUAL TABLE messages_fts USING fts5(
  text,
  content='messages',
  content_rowid='rowid',
  tokenize='trigram case_sensitive 0'
);

-- external content の再 index。messages テーブルから全件再投入される。
INSERT INTO messages_fts(messages_fts) VALUES('rebuild');
