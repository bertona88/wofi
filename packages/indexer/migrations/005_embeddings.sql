CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE embedding_job_status AS ENUM ('queued', 'processing', 'done', 'failed');

CREATE TABLE IF NOT EXISTS embedding_jobs (
  id BIGSERIAL PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(content_id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INT NOT NULL,
  input_hash TEXT NOT NULL,
  status embedding_job_status NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idea_id, model, dimensions, input_hash)
);

CREATE INDEX IF NOT EXISTS embedding_jobs_status_idx ON embedding_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS embedding_jobs_idea_idx ON embedding_jobs (idea_id);

CREATE TABLE IF NOT EXISTS idea_embeddings (
  idea_id TEXT NOT NULL REFERENCES ideas(content_id) ON DELETE CASCADE,
  model TEXT NOT NULL,
  dimensions INT NOT NULL,
  input_hash TEXT NOT NULL,
  embedding VECTOR(1536) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (idea_id, model, dimensions)
);

CREATE INDEX IF NOT EXISTS idea_embeddings_model_idx ON idea_embeddings (model, dimensions);
CREATE INDEX IF NOT EXISTS idea_embeddings_embedding_idx ON idea_embeddings USING hnsw (embedding vector_cosine_ops);
