-- P2-D AI Schema Intelligence suggestions.
-- This migration stores design-time, human-reviewable suggestions only. It
-- neither touches QUERYMIND_DATA nor grants runtime semantic authority.

CREATE TABLE IF NOT EXISTS semantic_suggestion_runs (
  run_id TEXT PRIMARY KEY,
  requested_by_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  schema_snapshot_id TEXT NOT NULL CHECK (length(schema_snapshot_id) BETWEEN 1 AND 128),
  -- Request configuration only (selected table names/types/bounds), never an
  -- EffectiveScope, a scope key, a row predicate, prompt, or provider payload.
  request_scope_json TEXT NOT NULL CHECK (json_valid(request_scope_json) AND length(request_scope_json) BETWEEN 2 AND 4000),
  authorized_catalog_fingerprint TEXT NOT NULL CHECK (length(authorized_catalog_fingerprint) = 64),
  prompt_version TEXT NOT NULL CHECK (length(prompt_version) BETWEEN 1 AND 80),
  prompt_fingerprint TEXT NOT NULL CHECK (length(prompt_fingerprint) = 64),
  provider TEXT NOT NULL CHECK (length(provider) BETWEEN 1 AND 80),
  model TEXT NOT NULL CHECK (length(model) BETWEEN 1 AND 160),
  model_config_fingerprint TEXT NOT NULL CHECK (length(model_config_fingerprint) = 64),
  status TEXT NOT NULL CHECK (status IN ('RUNNING', 'SUCCEEDED', 'FAILED')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count BETWEEN 0 AND 2),
  suggestion_count INTEGER NOT NULL DEFAULT 0 CHECK (suggestion_count BETWEEN 0 AND 20),
  error_code TEXT CHECK (error_code IS NULL OR length(error_code) <= 80),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TEXT
);

CREATE TABLE IF NOT EXISTS semantic_suggestions (
  suggestion_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES semantic_suggestion_runs(run_id) ON DELETE RESTRICT,
  suggestion_type TEXT NOT NULL CHECK (suggestion_type IN ('TERM', 'DIMENSION', 'METRIC', 'RELATIONSHIP')),
  status TEXT NOT NULL CHECK (status IN ('OPEN', 'ACCEPTED', 'DISMISSED')),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 120),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  confidence TEXT NOT NULL CHECK (confidence IN ('HIGH', 'MEDIUM', 'LOW')),
  suggestion_json TEXT NOT NULL CHECK (json_valid(suggestion_json) AND length(suggestion_json) BETWEEN 2 AND 32000),
  rationale_json TEXT NOT NULL CHECK (json_valid(rationale_json) AND length(rationale_json) BETWEEN 2 AND 8000),
  evidence_json TEXT NOT NULL CHECK (json_valid(evidence_json) AND length(evidence_json) BETWEEN 2 AND 8000),
  suggestion_fingerprint TEXT NOT NULL CHECK (length(suggestion_fingerprint) = 64),
  accepted_asset_id TEXT,
  accepted_revision_id TEXT,
  accepted_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  accepted_at TEXT,
  dismissed_by_user_id TEXT REFERENCES users(id) ON DELETE RESTRICT,
  dismissed_at TEXT,
  dismissal_reason TEXT CHECK (dismissal_reason IS NULL OR length(dismissal_reason) <= 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (run_id, suggestion_fingerprint),
  FOREIGN KEY (accepted_asset_id, accepted_revision_id)
    REFERENCES semantic_revisions(asset_id, revision_id) ON DELETE RESTRICT,
  CHECK (
    (status = 'OPEN'
      AND accepted_asset_id IS NULL AND accepted_revision_id IS NULL AND accepted_by_user_id IS NULL AND accepted_at IS NULL
      AND dismissed_by_user_id IS NULL AND dismissed_at IS NULL AND dismissal_reason IS NULL)
    OR (status = 'ACCEPTED'
      AND accepted_asset_id IS NOT NULL AND accepted_revision_id IS NOT NULL AND accepted_by_user_id IS NOT NULL AND accepted_at IS NOT NULL
      AND dismissed_by_user_id IS NULL AND dismissed_at IS NULL AND dismissal_reason IS NULL)
    OR (status = 'DISMISSED'
      AND accepted_asset_id IS NULL AND accepted_revision_id IS NULL AND accepted_by_user_id IS NULL AND accepted_at IS NULL
      AND dismissed_by_user_id IS NOT NULL AND dismissed_at IS NOT NULL)
  )
);

-- Generated content/evidence remains immutable. Only lifecycle/link fields
-- may change from OPEN to ACCEPTED or DISMISSED.
CREATE TRIGGER IF NOT EXISTS semantic_suggestions_generated_content_immutable
BEFORE UPDATE OF run_id, suggestion_type, canonical_name, display_name, confidence, suggestion_json, rationale_json, evidence_json, suggestion_fingerprint
ON semantic_suggestions
BEGIN
  SELECT RAISE(ABORT, 'semantic suggestion generated content is immutable');
END;

CREATE INDEX IF NOT EXISTS idx_semantic_suggestion_runs_owner_created
  ON semantic_suggestion_runs(requested_by_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_suggestions_run_status
  ON semantic_suggestions(run_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_suggestions_status_type
  ON semantic_suggestions(status, suggestion_type, created_at DESC);
