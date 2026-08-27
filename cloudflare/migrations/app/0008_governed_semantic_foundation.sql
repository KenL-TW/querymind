-- P2-A Governed Semantic Foundation.
-- Additive app metadata only. The business D1 remains read-only and
-- migrations 0001-0007, including the P0/P1 boundaries, are immutable.

-- A deterministic physical catalog identity used as semantic approval
-- provenance. The Worker updates it when the catalog snapshot changes.
ALTER TABLE schema_catalog_state
  ADD COLUMN schema_snapshot_id TEXT NOT NULL DEFAULT 'uninitialized';

CREATE TABLE IF NOT EXISTS semantic_registry_state (
  state_key TEXT PRIMARY KEY CHECK (state_key = 'global'),
  registry_version INTEGER NOT NULL CHECK (registry_version >= 0),
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT OR IGNORE INTO semantic_registry_state (state_key, registry_version, updated_at)
VALUES ('global', 0, CURRENT_TIMESTAMP);

CREATE TABLE IF NOT EXISTS semantic_assets (
  asset_id TEXT PRIMARY KEY,
  asset_type TEXT NOT NULL CHECK (asset_type IN ('TERM', 'DIMENSION', 'METRIC', 'RELATIONSHIP')),
  canonical_name TEXT NOT NULL CHECK (length(canonical_name) BETWEEN 1 AND 120),
  display_name TEXT NOT NULL CHECK (length(display_name) BETWEEN 1 AND 160),
  domain TEXT NOT NULL DEFAULT '' CHECK (length(domain) <= 80),
  description TEXT NOT NULL DEFAULT '' CHECK (length(description) <= 2000),
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  asset_status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK (asset_status IN ('ACTIVE', 'DEPRECATED')),
  current_approved_revision_id TEXT,
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  deprecated_at TEXT,
  UNIQUE (asset_type, canonical_name, domain)
);

CREATE TABLE IF NOT EXISTS semantic_revisions (
  revision_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES semantic_assets(asset_id) ON DELETE RESTRICT,
  revision_number INTEGER NOT NULL CHECK (revision_number > 0),
  revision_status TEXT NOT NULL CHECK (revision_status IN ('DRAFT', 'IN_REVIEW', 'APPROVED', 'REJECTED')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) BETWEEN 2 AND 32000),
  schema_snapshot_id TEXT NOT NULL CHECK (length(schema_snapshot_id) BETWEEN 1 AND 128),
  change_reason TEXT NOT NULL DEFAULT '' CHECK (length(change_reason) <= 1000),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  submitted_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  submitted_at TEXT,
  approved_by TEXT REFERENCES users(id) ON DELETE RESTRICT,
  approved_at TEXT,
  UNIQUE (asset_id, revision_number),
  UNIQUE (asset_id, revision_id)
);

CREATE TABLE IF NOT EXISTS semantic_sources (
  source_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  source_kind TEXT NOT NULL CHECK (source_kind IN ('TABLE', 'COLUMN', 'SEMANTIC_DEPENDENCY')),
  table_name TEXT,
  column_name TEXT,
  referenced_asset_id TEXT,
  referenced_revision_id TEXT,
  role TEXT NOT NULL CHECK (length(role) BETWEEN 1 AND 40),
  ordinal_position INTEGER NOT NULL CHECK (ordinal_position >= 0),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK (
    (source_kind = 'TABLE' AND table_name IS NOT NULL AND column_name IS NULL AND referenced_asset_id IS NULL AND referenced_revision_id IS NULL)
    OR (source_kind = 'COLUMN' AND table_name IS NOT NULL AND column_name IS NOT NULL AND referenced_asset_id IS NULL AND referenced_revision_id IS NULL)
    OR (source_kind = 'SEMANTIC_DEPENDENCY' AND table_name IS NULL AND column_name IS NULL AND referenced_asset_id IS NOT NULL AND referenced_revision_id IS NOT NULL)
  ),
  FOREIGN KEY (referenced_asset_id, referenced_revision_id)
    REFERENCES semantic_revisions(asset_id, revision_id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS semantic_aliases (
  alias_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  alias TEXT NOT NULL CHECK (length(alias) BETWEEN 1 AND 120),
  normalized_alias TEXT NOT NULL CHECK (length(normalized_alias) BETWEEN 1 AND 120),
  locale TEXT NOT NULL DEFAULT '' CHECK (length(locale) <= 16),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (revision_id, normalized_alias, locale)
);

CREATE TABLE IF NOT EXISTS semantic_relationship_keys (
  revision_id TEXT NOT NULL REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  ordinal_position INTEGER NOT NULL CHECK (ordinal_position >= 0),
  left_table TEXT NOT NULL CHECK (length(left_table) BETWEEN 1 AND 128),
  left_column TEXT NOT NULL CHECK (length(left_column) BETWEEN 1 AND 128),
  right_table TEXT NOT NULL CHECK (length(right_table) BETWEEN 1 AND 128),
  right_column TEXT NOT NULL CHECK (length(right_column) BETWEEN 1 AND 128),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (revision_id, ordinal_position),
  UNIQUE (revision_id, left_table, left_column, right_table, right_column)
);

CREATE TABLE IF NOT EXISTS semantic_reviews (
  review_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('SUBMITTED', 'APPROVED', 'REJECTED', 'REQUEST_CHANGES', 'DEPRECATED')),
  reviewer_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  comment TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_semantic_assets_status_type
  ON semantic_assets(asset_status, asset_type, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_assets_owner_status
  ON semantic_assets(owner_user_id, asset_status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_revisions_asset_status
  ON semantic_revisions(asset_id, revision_status, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_revisions_status
  ON semantic_revisions(revision_status, asset_id, revision_number DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_sources_revision
  ON semantic_sources(revision_id, source_kind, ordinal_position);
CREATE INDEX IF NOT EXISTS idx_semantic_sources_physical
  ON semantic_sources(source_kind, table_name, column_name);
CREATE INDEX IF NOT EXISTS idx_semantic_aliases_normalized
  ON semantic_aliases(normalized_alias, locale);
CREATE INDEX IF NOT EXISTS idx_semantic_relationship_keys_endpoint
  ON semantic_relationship_keys(left_table, left_column, right_table, right_column);
CREATE INDEX IF NOT EXISTS idx_semantic_reviews_revision_created
  ON semantic_reviews(revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_reviews_reviewer_created
  ON semantic_reviews(reviewer_user_id, created_at DESC);
