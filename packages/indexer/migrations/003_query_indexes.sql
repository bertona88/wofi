CREATE INDEX IF NOT EXISTS construction_inputs_construction_idx ON construction_inputs (construction_id);
CREATE INDEX IF NOT EXISTS construction_outputs_construction_idx ON construction_outputs (construction_id);
CREATE INDEX IF NOT EXISTS ideas_created_at_idx ON ideas (created_at);
CREATE INDEX IF NOT EXISTS constructions_created_at_idx ON constructions (created_at);
