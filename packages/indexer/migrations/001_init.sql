CREATE TYPE ingest_status AS ENUM ('ok', 'failed');

CREATE TABLE IF NOT EXISTS objects (
  content_id TEXT PRIMARY KEY,
  wofi_type TEXT NOT NULL,
  schema_version TEXT NOT NULL,
  canonical_json JSONB NOT NULL,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT,
  signature_json JSONB,
  arweave_tx_id TEXT UNIQUE,
  ingested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  ingest_status ingest_status NOT NULL,
  ingest_error TEXT
);

CREATE INDEX IF NOT EXISTS objects_type_created_idx ON objects (wofi_type, created_at);
CREATE INDEX IF NOT EXISTS objects_arweave_tx_idx ON objects (arweave_tx_id);

CREATE TABLE IF NOT EXISTS ideas (
  content_id TEXT PRIMARY KEY,
  title TEXT,
  kind TEXT,
  summary TEXT,
  tags JSONB,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT
);

CREATE TABLE IF NOT EXISTS constructions (
  content_id TEXT PRIMARY KEY,
  operator TEXT NOT NULL,
  profile_id TEXT,
  params_json JSONB,
  constraints_json JSONB,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT
);

CREATE TABLE IF NOT EXISTS construction_inputs (
  construction_id TEXT REFERENCES constructions(content_id) ON DELETE CASCADE,
  input_idea_id TEXT REFERENCES ideas(content_id) ON DELETE CASCADE,
  role TEXT,
  ordinal INT NOT NULL,
  PRIMARY KEY (construction_id, ordinal)
);

CREATE TABLE IF NOT EXISTS construction_outputs (
  construction_id TEXT REFERENCES constructions(content_id) ON DELETE CASCADE,
  output_idea_id TEXT REFERENCES ideas(content_id) ON DELETE CASCADE,
  PRIMARY KEY (construction_id)
);

CREATE TABLE IF NOT EXISTS claims (
  content_id TEXT PRIMARY KEY,
  about_type TEXT CHECK (about_type IS NULL OR about_type IN ('idea', 'implementation')),
  about_id TEXT,
  claim_text TEXT,
  resolution_type TEXT,
  resolution_json JSONB,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT
);

CREATE TABLE IF NOT EXISTS evidence (
  content_id TEXT PRIMARY KEY,
  claim_id TEXT REFERENCES claims(content_id) ON DELETE CASCADE,
  stance TEXT CHECK (stance IS NULL OR stance IN ('supports', 'refutes')),
  locator TEXT,
  excerpt_hash TEXT,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT
);

CREATE TABLE IF NOT EXISTS implementations (
  content_id TEXT PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(content_id) ON DELETE CASCADE,
  metadata_json JSONB,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT
);

CREATE TABLE IF NOT EXISTS profiles (
  content_id TEXT PRIMARY KEY,
  weights_json JSONB,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT
);

CREATE TABLE IF NOT EXISTS edges (
  content_id TEXT PRIMARY KEY,
  rel TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  created_at TIMESTAMPTZ,
  author_pubkey TEXT
);

CREATE INDEX IF NOT EXISTS construction_inputs_input_idx ON construction_inputs (input_idea_id);
CREATE INDEX IF NOT EXISTS construction_outputs_output_idx ON construction_outputs (output_idea_id);
CREATE INDEX IF NOT EXISTS claims_about_idx ON claims (about_id);
CREATE INDEX IF NOT EXISTS evidence_claim_idx ON evidence (claim_id);
CREATE INDEX IF NOT EXISTS edges_rel_from_to_idx ON edges (rel, from_id, to_id);

CREATE TABLE IF NOT EXISTS ingest_deferred (
  content_id TEXT PRIMARY KEY,
  wofi_type TEXT NOT NULL,
  missing_ref TEXT,
  reason TEXT,
  first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS backfill_checkpoints (
  source TEXT NOT NULL,
  wofi_type TEXT NOT NULL,
  cursor TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (source, wofi_type)
);
