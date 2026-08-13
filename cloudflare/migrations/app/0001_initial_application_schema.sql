-- QueryMind application metadata. This database never stores an OpenAI key.
-- Application-level authorization is intentionally simple: no table-level policy model.
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT
);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT REFERENCES users(id),
  title TEXT NOT NULL DEFAULT '',
  summary TEXT NOT NULL DEFAULT '',
  entities_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(entities_json)),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK (pinned IN (0, 1)),
  archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system', 'tool')),
  content TEXT NOT NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS query_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES chat_sessions(id) ON DELETE SET NULL,
  user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  prompt TEXT NOT NULL,
  generated_sql TEXT,
  validated_sql TEXT,
  row_count INTEGER,
  duration_ms INTEGER,
  outcome TEXT NOT NULL CHECK (outcome IN ('success', 'rejected', 'error')),
  error_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS audit_events (
  id TEXT PRIMARY KEY,
  actor_id TEXT REFERENCES users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  resource_type TEXT,
  resource_id TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(metadata_json)),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- The normalized catalog is the first schema-awareness layer passed to the AI.
-- It is derived from QUERYMIND_DATA; do not manually edit it during normal operation.
CREATE TABLE IF NOT EXISTS schema_catalog_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  source_schema_version TEXT,
  refreshed_at TEXT,
  table_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS schema_catalog_tables (
  table_name TEXT PRIMARY KEY,
  create_sql TEXT NOT NULL,
  row_count INTEGER,
  description TEXT NOT NULL DEFAULT '',
  refreshed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS schema_catalog_columns (
  table_name TEXT NOT NULL REFERENCES schema_catalog_tables(table_name) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  ordinal_position INTEGER NOT NULL,
  data_type TEXT NOT NULL,
  is_not_null INTEGER NOT NULL CHECK (is_not_null IN (0, 1)),
  is_primary_key INTEGER NOT NULL CHECK (is_primary_key IN (0, 1)),
  default_value TEXT,
  description TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (table_name, column_name)
);

CREATE TABLE IF NOT EXISTS schema_catalog_foreign_keys (
  table_name TEXT NOT NULL REFERENCES schema_catalog_tables(table_name) ON DELETE CASCADE,
  column_name TEXT NOT NULL,
  referenced_table TEXT NOT NULL,
  referenced_column TEXT NOT NULL,
  PRIMARY KEY (table_name, column_name, referenced_table, referenced_column)
);

CREATE TABLE IF NOT EXISTS column_policies (
  table_name TEXT NOT NULL,
  column_name TEXT NOT NULL,
  classification TEXT NOT NULL DEFAULT 'internal' CHECK (classification IN ('public', 'internal', 'sensitive')),
  mask_mode TEXT NOT NULL DEFAULT 'none' CHECK (mask_mode IN ('none', 'partial', 'full')),
  PRIMARY KEY (table_name, column_name)
);

CREATE TABLE IF NOT EXISTS query_templates (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  prompt TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  is_pinned INTEGER NOT NULL DEFAULT 0 CHECK (is_pinned IN (0, 1)),
  created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_updated ON chat_sessions(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_session_created ON chat_messages(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_query_runs_session_created ON query_runs(session_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_actor_created ON audit_events(actor_id, created_at DESC);
