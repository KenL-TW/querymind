-- P2-E: Human Semantic Approval & Publication Governance.
-- Additive, forward-only APP metadata. No QUERYMIND_DATA changes and no
-- production authority is seeded: approval fails closed until a human
-- governance administrator configures policy and RACI authority.

CREATE TABLE IF NOT EXISTS semantic_governance_policies (
  policy_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL UNIQUE CHECK (length(scope_key) BETWEEN 8 AND 180),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('DOMAIN', 'ASSET')),
  domain TEXT NOT NULL DEFAULT '' CHECK (length(domain) <= 80),
  asset_id TEXT REFERENCES semantic_assets(asset_id) ON DELETE RESTRICT,
  risk_class TEXT NOT NULL CHECK (risk_class IN ('LOW', 'STANDARD', 'HIGH', 'CRITICAL')),
  required_approvals INTEGER NOT NULL CHECK (required_approvals BETWEEN 1 AND 5),
  allow_proposer_self_approval INTEGER NOT NULL DEFAULT 0 CHECK (allow_proposer_self_approval IN (0, 1)),
  allow_emergency_publication INTEGER NOT NULL DEFAULT 0 CHECK (allow_emergency_publication IN (0, 1)),
  post_review_due_hours INTEGER NOT NULL DEFAULT 72 CHECK (post_review_due_hours BETWEEN 1 AND 720),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'DOMAIN' AND asset_id IS NULL) OR (scope_kind = 'ASSET' AND asset_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS semantic_authorities (
  authority_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL CHECK (length(scope_key) BETWEEN 8 AND 180),
  scope_kind TEXT NOT NULL CHECK (scope_kind IN ('DOMAIN', 'ASSET')),
  domain TEXT NOT NULL DEFAULT '' CHECK (length(domain) <= 80),
  asset_id TEXT REFERENCES semantic_assets(asset_id) ON DELETE RESTRICT,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  raci_role TEXT NOT NULL CHECK (raci_role IN ('DATA_OWNER', 'DATA_STEWARD', 'SEMANTIC_APPROVER')),
  can_approve INTEGER NOT NULL DEFAULT 0 CHECK (can_approve IN (0, 1)),
  can_govern_runtime INTEGER NOT NULL DEFAULT 0 CHECK (can_govern_runtime IN (0, 1)),
  is_active INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((scope_kind = 'DOMAIN' AND asset_id IS NULL) OR (scope_kind = 'ASSET' AND asset_id IS NOT NULL)),
  UNIQUE (scope_key, user_id, raci_role)
);

CREATE TABLE IF NOT EXISTS semantic_approval_decisions (
  decision_id TEXT PRIMARY KEY,
  revision_id TEXT NOT NULL REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  decision TEXT NOT NULL CHECK (decision IN ('APPROVE', 'EMERGENCY_PUBLISH')),
  policy_id TEXT NOT NULL REFERENCES semantic_governance_policies(policy_id) ON DELETE RESTRICT,
  authority_id TEXT NOT NULL REFERENCES semantic_authorities(authority_id) ON DELETE RESTRICT,
  risk_class TEXT NOT NULL CHECK (risk_class IN ('LOW', 'STANDARD', 'HIGH', 'CRITICAL')),
  approval_slot INTEGER NOT NULL CHECK (approval_slot BETWEEN 1 AND 5),
  comment TEXT NOT NULL DEFAULT '' CHECK (length(comment) <= 2000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (revision_id, actor_user_id, decision)
);

CREATE TABLE IF NOT EXISTS semantic_publications (
  publication_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES semantic_assets(asset_id) ON DELETE RESTRICT,
  revision_id TEXT NOT NULL UNIQUE REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  publication_mode TEXT NOT NULL CHECK (publication_mode IN ('NORMAL', 'EMERGENCY')),
  schema_snapshot_id TEXT NOT NULL CHECK (length(schema_snapshot_id) BETWEEN 1 AND 128),
  validator_version TEXT NOT NULL CHECK (length(validator_version) BETWEEN 1 AND 80),
  registry_version_before INTEGER NOT NULL CHECK (registry_version_before >= 0),
  registry_version_after INTEGER NOT NULL CHECK (registry_version_after >= 1),
  published_by TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  published_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  emergency_reason TEXT NOT NULL DEFAULT '' CHECK (length(emergency_reason) <= 1000),
  change_reference TEXT NOT NULL DEFAULT '' CHECK (length(change_reference) <= 160),
  review_due_at TEXT,
  post_review_status TEXT NOT NULL DEFAULT 'NOT_REQUIRED' CHECK (post_review_status IN ('NOT_REQUIRED', 'PENDING', 'CONFIRMED', 'REQUIRES_CORRECTION')),
  runtime_eligibility TEXT NOT NULL DEFAULT 'ELIGIBLE' CHECK (runtime_eligibility IN ('ELIGIBLE', 'SUSPENDED')),
  runtime_updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((publication_mode = 'NORMAL' AND emergency_reason = '' AND change_reference = '' AND review_due_at IS NULL AND post_review_status = 'NOT_REQUIRED')
      OR (publication_mode = 'EMERGENCY' AND length(emergency_reason) > 0 AND length(change_reference) > 0 AND review_due_at IS NOT NULL AND post_review_status IN ('PENDING', 'CONFIRMED', 'REQUIRES_CORRECTION'))),
  CHECK (registry_version_after = registry_version_before + 1)
);

CREATE TABLE IF NOT EXISTS semantic_runtime_events (
  event_id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES semantic_publications(publication_id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('SUSPEND', 'RESUME', 'POST_REVIEW_CONFIRMED', 'POST_REVIEW_REQUIRES_CORRECTION')),
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS semantic_governance_idempotency (
  idempotency_id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  operation TEXT NOT NULL CHECK (operation IN ('APPROVE', 'EMERGENCY_PUBLISH', 'SUSPEND_RUNTIME', 'RESUME_RUNTIME', 'POST_REVIEW')),
  asset_id TEXT NOT NULL REFERENCES semantic_assets(asset_id) ON DELETE RESTRICT,
  revision_id TEXT NOT NULL REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  idempotency_key TEXT NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 128),
  result_code TEXT NOT NULL CHECK (length(result_code) BETWEEN 1 AND 80),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (actor_user_id, operation, asset_id, revision_id, idempotency_key)
);

-- Publication commands are immutable, bounded inputs to the SQLite trigger
-- below. Keeping the command makes the single-statement publication boundary
-- inspectable while the trigger guarantees that a failed precondition aborts
-- the whole D1 batch (including its just-recorded final approval vote).
CREATE TABLE IF NOT EXISTS semantic_publication_commands (
  command_id TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES semantic_assets(asset_id) ON DELETE RESTRICT,
  revision_id TEXT NOT NULL REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  policy_id TEXT NOT NULL REFERENCES semantic_governance_policies(policy_id) ON DELETE RESTRICT,
  authority_id TEXT NOT NULL REFERENCES semantic_authorities(authority_id) ON DELETE RESTRICT,
  publication_mode TEXT NOT NULL CHECK (publication_mode IN ('NORMAL', 'EMERGENCY')),
  expected_registry_version INTEGER NOT NULL CHECK (expected_registry_version >= 0),
  validator_version TEXT NOT NULL CHECK (length(validator_version) BETWEEN 1 AND 80),
  emergency_reason TEXT NOT NULL DEFAULT '' CHECK (length(emergency_reason) <= 1000),
  change_reference TEXT NOT NULL DEFAULT '' CHECK (length(change_reference) <= 160),
  review_due_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CHECK ((publication_mode = 'NORMAL' AND emergency_reason = '' AND change_reference = '' AND review_due_at IS NULL)
      OR (publication_mode = 'EMERGENCY' AND length(emergency_reason) > 0 AND length(change_reference) > 0 AND review_due_at IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS semantic_runtime_commands (
  command_id TEXT PRIMARY KEY,
  publication_id TEXT NOT NULL REFERENCES semantic_publications(publication_id) ON DELETE RESTRICT,
  asset_id TEXT NOT NULL REFERENCES semantic_assets(asset_id) ON DELETE RESTRICT,
  revision_id TEXT NOT NULL REFERENCES semantic_revisions(revision_id) ON DELETE RESTRICT,
  actor_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  authority_id TEXT NOT NULL REFERENCES semantic_authorities(authority_id) ON DELETE RESTRICT,
  action TEXT NOT NULL CHECK (action IN ('SUSPEND', 'RESUME', 'POST_REVIEW_CONFIRMED', 'POST_REVIEW_REQUIRES_CORRECTION')),
  expected_registry_version INTEGER NOT NULL CHECK (expected_registry_version >= 0),
  reason TEXT NOT NULL DEFAULT '' CHECK (length(reason) <= 1000),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TRIGGER IF NOT EXISTS semantic_publication_command_guard
BEFORE INSERT ON semantic_publication_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM semantic_revisions r
    JOIN semantic_assets a ON a.asset_id = r.asset_id
    JOIN semantic_governance_policies p ON p.policy_id = NEW.policy_id AND p.is_active = 1
    JOIN semantic_authorities au ON au.authority_id = NEW.authority_id AND au.user_id = NEW.actor_user_id AND au.is_active = 1 AND au.can_approve = 1
    JOIN schema_catalog_state sc ON sc.id = 1
    JOIN semantic_registry_state rs ON rs.state_key = 'global'
    WHERE r.revision_id = NEW.revision_id
      AND r.asset_id = NEW.asset_id
      AND r.revision_status = 'IN_REVIEW'
      AND a.asset_status = 'ACTIVE'
      AND r.schema_snapshot_id = sc.schema_snapshot_id
      AND rs.registry_version = NEW.expected_registry_version
      AND NOT EXISTS (SELECT 1 FROM semantic_publications sp WHERE sp.revision_id = r.revision_id)
      AND (
        (NEW.publication_mode = 'NORMAL'
          AND p.required_approvals <= (SELECT COUNT(DISTINCT d.actor_user_id) FROM semantic_approval_decisions d WHERE d.revision_id = r.revision_id AND d.decision = 'APPROVE')
          AND (p.allow_proposer_self_approval = 1 OR r.created_by <> NEW.actor_user_id))
        OR (NEW.publication_mode = 'EMERGENCY'
          AND p.allow_emergency_publication = 1
          AND EXISTS (SELECT 1 FROM semantic_approval_decisions d WHERE d.revision_id = r.revision_id AND d.actor_user_id = NEW.actor_user_id AND d.decision = 'EMERGENCY_PUBLISH'))
      )
  ) THEN RAISE(ABORT, 'semantic publication precondition failed') END;
END;

CREATE TRIGGER IF NOT EXISTS semantic_publication_command_apply
AFTER INSERT ON semantic_publication_commands
BEGIN
  UPDATE semantic_revisions
  SET revision_status = 'APPROVED', approved_by = NEW.actor_user_id, approved_at = NEW.created_at
  WHERE revision_id = NEW.revision_id AND asset_id = NEW.asset_id AND revision_status = 'IN_REVIEW';

  UPDATE semantic_assets
  SET current_approved_revision_id = NEW.revision_id, updated_at = NEW.created_at
  WHERE asset_id = NEW.asset_id AND asset_status = 'ACTIVE';

  UPDATE semantic_registry_state
  SET registry_version = registry_version + 1, updated_at = NEW.created_at
  WHERE state_key = 'global' AND registry_version = NEW.expected_registry_version;

  INSERT INTO semantic_publications (
    publication_id, asset_id, revision_id, publication_mode, schema_snapshot_id, validator_version,
    registry_version_before, registry_version_after, published_by, published_at, emergency_reason,
    change_reference, review_due_at, post_review_status, runtime_eligibility, runtime_updated_at
  )
  SELECT NEW.command_id, NEW.asset_id, NEW.revision_id, NEW.publication_mode, r.schema_snapshot_id, NEW.validator_version,
    NEW.expected_registry_version, NEW.expected_registry_version + 1, NEW.actor_user_id, NEW.created_at, NEW.emergency_reason,
    NEW.change_reference, NEW.review_due_at,
    IIF(NEW.publication_mode = 'EMERGENCY', 'PENDING', 'NOT_REQUIRED'),
    'ELIGIBLE', NEW.created_at
  FROM semantic_revisions r WHERE r.revision_id = NEW.revision_id AND r.revision_status = 'APPROVED';

  INSERT INTO semantic_reviews (review_id, revision_id, action, reviewer_user_id, comment, created_at)
  VALUES (NEW.command_id, NEW.revision_id, 'APPROVED', NEW.actor_user_id, '', NEW.created_at);

  INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at)
  VALUES (NEW.command_id, NEW.actor_user_id,
    IIF(NEW.publication_mode = 'EMERGENCY', 'semantic.publication.emergency', 'semantic.publication.normal'),
    'semantic_publication', NEW.command_id,
    json_object('assetId', NEW.asset_id, 'revisionId', NEW.revision_id, 'publicationMode', NEW.publication_mode,
      'registryVersionBefore', NEW.expected_registry_version, 'registryVersionAfter', NEW.expected_registry_version + 1),
    NEW.created_at);
END;

CREATE TRIGGER IF NOT EXISTS semantic_runtime_command_guard
BEFORE INSERT ON semantic_runtime_commands
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM semantic_publications sp
    JOIN semantic_revisions r ON r.revision_id = sp.revision_id
    JOIN semantic_assets a ON a.asset_id = sp.asset_id
    JOIN semantic_authorities au ON au.authority_id = NEW.authority_id AND au.user_id = NEW.actor_user_id AND au.is_active = 1 AND au.can_govern_runtime = 1
    JOIN semantic_registry_state rs ON rs.state_key = 'global'
    WHERE sp.publication_id = NEW.publication_id
      AND sp.asset_id = NEW.asset_id
      AND sp.revision_id = NEW.revision_id
      AND r.revision_status = 'APPROVED'
      AND a.current_approved_revision_id = NEW.revision_id
      AND rs.registry_version = NEW.expected_registry_version
      AND ((NEW.action = 'SUSPEND' AND sp.runtime_eligibility = 'ELIGIBLE' AND length(NEW.reason) > 0)
        OR (NEW.action = 'RESUME' AND sp.runtime_eligibility = 'SUSPENDED' AND length(NEW.reason) > 0)
        OR (NEW.action = 'POST_REVIEW_CONFIRMED' AND sp.publication_mode = 'EMERGENCY' AND sp.post_review_status = 'PENDING')
        OR (NEW.action = 'POST_REVIEW_REQUIRES_CORRECTION' AND sp.publication_mode = 'EMERGENCY' AND sp.post_review_status = 'PENDING' AND length(NEW.reason) > 0))
  ) THEN RAISE(ABORT, 'semantic runtime governance precondition failed') END;
END;

CREATE TRIGGER IF NOT EXISTS semantic_runtime_command_apply
AFTER INSERT ON semantic_runtime_commands
BEGIN
  UPDATE semantic_publications
  SET runtime_eligibility = IIF(NEW.action = 'SUSPEND', 'SUSPENDED', IIF(NEW.action = 'RESUME', 'ELIGIBLE', runtime_eligibility)),
      runtime_updated_at = NEW.created_at,
      post_review_status = IIF(NEW.action = 'POST_REVIEW_CONFIRMED', 'CONFIRMED', IIF(NEW.action = 'POST_REVIEW_REQUIRES_CORRECTION', 'REQUIRES_CORRECTION', post_review_status))
  WHERE publication_id = NEW.publication_id;

  UPDATE semantic_registry_state
  SET registry_version = registry_version + 1, updated_at = NEW.created_at
  WHERE state_key = 'global' AND registry_version = NEW.expected_registry_version AND NEW.action IN ('SUSPEND', 'RESUME');

  INSERT INTO semantic_runtime_events (event_id, publication_id, actor_user_id, action, reason, created_at)
  VALUES (NEW.command_id, NEW.publication_id, NEW.actor_user_id, NEW.action, NEW.reason, NEW.created_at);

  INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at)
  VALUES (NEW.command_id, NEW.actor_user_id,
    IIF(NEW.action = 'SUSPEND', 'semantic.runtime.suspended', IIF(NEW.action = 'RESUME', 'semantic.runtime.resumed', 'semantic.emergency.post_review')),
    'semantic_publication', NEW.publication_id,
    json_object('assetId', NEW.asset_id, 'revisionId', NEW.revision_id, 'action', NEW.action,
      'registryVersionBefore', NEW.expected_registry_version,
      'registryVersionAfter', NEW.expected_registry_version + IIF(NEW.action IN ('SUSPEND', 'RESUME'), 1, 0)),
    NEW.created_at);
END;

CREATE INDEX IF NOT EXISTS idx_semantic_governance_policies_scope ON semantic_governance_policies(scope_kind, domain, asset_id, is_active);
CREATE INDEX IF NOT EXISTS idx_semantic_authorities_scope ON semantic_authorities(scope_kind, domain, asset_id, user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_semantic_approval_decisions_revision ON semantic_approval_decisions(revision_id, decision, created_at);
CREATE INDEX IF NOT EXISTS idx_semantic_publications_asset_current ON semantic_publications(asset_id, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_runtime_events_publication ON semantic_runtime_events(publication_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_publication_commands_revision ON semantic_publication_commands(revision_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_semantic_runtime_commands_publication ON semantic_runtime_commands(publication_id, created_at DESC);
