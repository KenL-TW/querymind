ALTER TABLE users ADD COLUMN password_algorithm TEXT NOT NULL DEFAULT 'pbkdf2-sha256-100000';

CREATE TABLE IF NOT EXISTS rate_limit_counters (
  subject_key TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (subject_key, window_start)
);

CREATE TABLE IF NOT EXISTS ai_usage_events (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  model TEXT NOT NULL,
  input_characters INTEGER NOT NULL,
  provider_requests INTEGER NOT NULL DEFAULT 0,
  row_count INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK (status IN ('success', 'rejected', 'error')),
  error_code TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_expiry ON rate_limit_counters(expires_at);
CREATE INDEX IF NOT EXISTS idx_ai_usage_user_created ON ai_usage_events(user_id, created_at DESC);

