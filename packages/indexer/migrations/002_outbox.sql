CREATE TABLE IF NOT EXISTS outbox (
  content_id TEXT PRIMARY KEY,
  canonical_json JSONB NOT NULL,
  arweave_tx_id TEXT,
  tx_id TEXT,
  status TEXT,
  last_error TEXT,
  attempts INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS outbox_created_at_idx ON outbox (created_at);
