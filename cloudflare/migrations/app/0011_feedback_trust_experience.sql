-- P1.2: structured, query-run-linked feedback capture.
-- Additive only: existing P1 feedback rows remain valid and retain their
-- original rating/category/comment values.
ALTER TABLE query_feedback ADD COLUMN feedback_version TEXT NOT NULL DEFAULT 'p1';
ALTER TABLE query_feedback ADD COLUMN target_type TEXT NOT NULL DEFAULT 'WHOLE_ANSWER';
ALTER TABLE query_feedback ADD COLUMN target_ref TEXT;
ALTER TABLE query_feedback ADD COLUMN issue_category TEXT;
ALTER TABLE query_feedback ADD COLUMN correction_text TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_query_feedback_target ON query_feedback(query_run_id, target_type);
CREATE INDEX IF NOT EXISTS idx_query_feedback_version_created ON query_feedback(feedback_version, created_at);
