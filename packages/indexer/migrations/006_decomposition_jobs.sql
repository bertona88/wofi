CREATE TYPE decomposition_job_status AS ENUM ('queued', 'processing', 'done', 'failed');

CREATE TABLE IF NOT EXISTS decomposition_jobs (
  id BIGSERIAL PRIMARY KEY,
  idea_id TEXT NOT NULL REFERENCES ideas(content_id) ON DELETE CASCADE,
  profile_id TEXT NOT NULL,
  opts_json JSONB,
  input_hash TEXT NOT NULL,
  status decomposition_job_status NOT NULL DEFAULT 'queued',
  attempts INT NOT NULL DEFAULT 0,
  last_error TEXT,
  claimed_at TIMESTAMPTZ,
  claimed_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (idea_id, profile_id, input_hash)
);

CREATE INDEX IF NOT EXISTS decomposition_jobs_status_idx ON decomposition_jobs (status, created_at);
CREATE INDEX IF NOT EXISTS decomposition_jobs_idea_idx ON decomposition_jobs (idea_id);
CREATE INDEX IF NOT EXISTS decomposition_jobs_profile_idx ON decomposition_jobs (profile_id);
