-- P1 Explainable Query Experience. Additive only; migration 0006 remains immutable.
ALTER TABLE query_runs ADD COLUMN explainability_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(explainability_json));

CREATE TABLE IF NOT EXISTS query_feedback (
  id TEXT PRIMARY KEY,
  query_run_id TEXT NOT NULL REFERENCES query_runs(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  category TEXT CHECK (category IS NULL OR category IN ('interpretation', 'source', 'calculation', 'incomplete', 'scope', 'other')),
  comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (query_run_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_query_feedback_user_created
  ON query_feedback(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_query_feedback_run
  ON query_feedback(query_run_id);
