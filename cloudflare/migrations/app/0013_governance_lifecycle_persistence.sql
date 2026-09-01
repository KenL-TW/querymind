-- P2-Ia: Governance records are immutable history. The P2-E schema made
-- scope_key (and an authority assignment) permanently unique, which made a
-- deactivated record impossible to replace. Preserve every historical row
-- while allowing exactly one active policy per scope and one active authority
-- assignment per scope/user/RACI tuple.
--
-- No semantic asset, revision, publication, registry version, or business
-- data is changed by this migration.

PRAGMA foreign_keys = OFF;

CREATE TABLE semantic_governance_policies_p2ia (
  policy_id TEXT PRIMARY KEY,
  scope_key TEXT NOT NULL CHECK (length(scope_key) BETWEEN 8 AND 180),
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

INSERT INTO semantic_governance_policies_p2ia (
  policy_id, scope_key, scope_kind, domain, asset_id, risk_class, required_approvals,
  allow_proposer_self_approval, allow_emergency_publication, post_review_due_hours,
  is_active, created_by, created_at, updated_at
)
SELECT
  policy_id, scope_key, scope_kind, domain, asset_id, risk_class, required_approvals,
  allow_proposer_self_approval, allow_emergency_publication, post_review_due_hours,
  is_active, created_by, created_at, updated_at
FROM semantic_governance_policies;

-- These P2-E trigger bodies reference the two tables being rebuilt. Drop and
-- recreate the unchanged trigger contracts around the table swap so SQLite
-- does not rewrite their references to a temporary table name.
DROP TRIGGER IF EXISTS semantic_publication_command_guard;
DROP TRIGGER IF EXISTS semantic_publication_command_apply;
DROP TRIGGER IF EXISTS semantic_runtime_command_guard;
DROP TRIGGER IF EXISTS semantic_runtime_command_apply;

DROP TABLE semantic_governance_policies;
ALTER TABLE semantic_governance_policies_p2ia RENAME TO semantic_governance_policies;

CREATE UNIQUE INDEX uq_semantic_governance_policy_active_scope
  ON semantic_governance_policies(scope_key)
  WHERE is_active = 1;
CREATE INDEX idx_semantic_governance_policies_scope
  ON semantic_governance_policies(scope_kind, domain, asset_id, is_active);

CREATE TABLE semantic_authorities_p2ia (
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
  CHECK ((scope_kind = 'DOMAIN' AND asset_id IS NULL) OR (scope_kind = 'ASSET' AND asset_id IS NOT NULL))
);

INSERT INTO semantic_authorities_p2ia (
  authority_id, scope_key, scope_kind, domain, asset_id, user_id, raci_role,
  can_approve, can_govern_runtime, is_active, created_by, created_at, updated_at
)
SELECT
  authority_id, scope_key, scope_kind, domain, asset_id, user_id, raci_role,
  can_approve, can_govern_runtime, is_active, created_by, created_at, updated_at
FROM semantic_authorities;

DROP TABLE semantic_authorities;
ALTER TABLE semantic_authorities_p2ia RENAME TO semantic_authorities;

CREATE UNIQUE INDEX uq_semantic_authority_active_assignment
  ON semantic_authorities(scope_key, user_id, raci_role)
  WHERE is_active = 1;
CREATE INDEX idx_semantic_authorities_scope
  ON semantic_authorities(scope_kind, domain, asset_id, user_id, is_active);

CREATE TRIGGER semantic_publication_command_guard
BEFORE INSERT ON semantic_publication_commands
BEGIN
  SELECT IIF(NOT EXISTS (
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
  ), RAISE(ABORT, 'semantic publication precondition failed'), NULL);
END;

CREATE TRIGGER semantic_publication_command_apply
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

CREATE TRIGGER semantic_runtime_command_guard
BEFORE INSERT ON semantic_runtime_commands
BEGIN
  SELECT IIF(NOT EXISTS (
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
  ), RAISE(ABORT, 'semantic runtime governance precondition failed'), NULL);
END;

CREATE TRIGGER semantic_runtime_command_apply
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

PRAGMA foreign_keys = ON;
