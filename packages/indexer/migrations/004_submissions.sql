CREATE TABLE IF NOT EXISTS submissions (
  content_id TEXT PRIMARY KEY,
  payload_kind TEXT,
  payload_value TEXT,
  payload_hash TEXT,
  mime_type TEXT,
  context_json JSONB,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT
);

CREATE INDEX IF NOT EXISTS submissions_payload_hash_idx ON submissions (payload_hash);
CREATE INDEX IF NOT EXISTS submissions_author_idx ON submissions (author_pubkey);
CREATE INDEX IF NOT EXISTS submissions_created_at_idx ON submissions (created_at);
