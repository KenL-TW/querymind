import type { AuthenticatedUser } from "./auth";
import { hasCapability } from "./auth";
import { assertPinnedDependencies, assertSemanticCatalogReferences, getSchemaSnapshotId, getSemanticRegistryVersion, SemanticRepositoryError } from "./semantic-repository";
import { SemanticValidationError, validateContract, validateOpaqueId, validateReviewComment } from "./semantic-validation";
import type { SemanticAssetType, SemanticContract, SemanticRevisionStatus } from "./semantic-types";

export const SEMANTIC_APPROVAL_VALIDATOR_VERSION = "p2-e-v1";
export const SEMANTIC_RISK_CLASSES = ["LOW", "STANDARD", "HIGH", "CRITICAL"] as const;
export type SemanticRiskClass = (typeof SEMANTIC_RISK_CLASSES)[number];
export const SEMANTIC_RACI_ROLES = ["DATA_OWNER", "DATA_STEWARD", "SEMANTIC_APPROVER"] as const;
export type SemanticRaciRole = (typeof SEMANTIC_RACI_ROLES)[number];
export type SemanticGovernanceAction = "APPROVE" | "EMERGENCY_PUBLISH" | "SUSPEND_RUNTIME" | "RESUME_RUNTIME" | "POST_REVIEW";

export class SemanticGovernanceError extends Error {
  constructor(readonly code: string, message: string, readonly field?: string) { super(message); }
}

export interface SemanticGovernanceAsset {
  assetId: string;
  assetType: SemanticAssetType;
  domain: string;
  assetStatus: "ACTIVE" | "DEPRECATED";
  currentApprovedRevisionId: string | null;
}

export interface SemanticGovernanceRevision {
  revisionId: string;
  assetId: string;
  revisionNumber: number;
  revisionStatus: SemanticRevisionStatus;
  payloadJson: string;
  schemaSnapshotId: string;
  createdBy: string;
  submittedBy: string | null;
}

interface PolicyRow {
  policy_id: string;
  scope_key: string;
  scope_kind: "DOMAIN" | "ASSET";
  domain: string;
  asset_id: string | null;
  risk_class: SemanticRiskClass;
  required_approvals: number;
  allow_proposer_self_approval: number;
  allow_emergency_publication: number;
  post_review_due_hours: number;
}

interface AuthorityRow {
  authority_id: string;
  scope_key: string;
  scope_kind: "DOMAIN" | "ASSET";
  user_id: string;
  raci_role: SemanticRaciRole;
  can_approve: number;
  can_govern_runtime: number;
}

interface RevisionRow {
  revision_id: string;
  asset_id: string;
  revision_number: number;
  revision_status: SemanticRevisionStatus;
  payload_json: string;
  schema_snapshot_id: string;
  created_by: string;
  submitted_by: string | null;
}

interface PublicationRow {
  publication_id: string;
  publication_mode: "NORMAL" | "EMERGENCY";
  runtime_eligibility: "ELIGIBLE" | "SUSPENDED";
  post_review_status: "NOT_REQUIRED" | "PENDING" | "CONFIRMED" | "REQUIRES_CORRECTION";
  schema_snapshot_id: string;
}

export interface AuthorizedSemanticCatalog {
  schemaSnapshotId: string;
  columns: Set<string>;
  tables: Set<string>;
}

export interface ApprovalReadiness {
  status: "READY" | "BLOCKED";
  code: string;
  message: string;
  failures: Array<{ code: string; message: string; field?: string; severity: "ERROR" }>;
  policy: {
    policyId: string;
    scopeKind: "DOMAIN" | "ASSET";
    riskClass: SemanticRiskClass;
    requiredApprovals: number;
    completedApprovals: number;
    remainingApprovals: number;
    allowProposerSelfApproval: boolean;
    allowEmergencyPublication: boolean;
    postReviewDueHours: number;
  } | null;
  authority: { authorityId: string; scopeKind: "DOMAIN" | "ASSET"; raciRole: SemanticRaciRole } | null;
  schemaSnapshotId: string | null;
  registryVersion: number | null;
}

function scopeKey(kind: "DOMAIN" | "ASSET", domain: string, assetId?: string): string {
  return kind === "ASSET" ? `asset:${assetId ?? ""}` : `domain:${domain || "_default"}`;
}

function fail(code: string, message: string, field?: string): ApprovalReadiness {
  return { status: "BLOCKED", code, message, failures: [{ code, message, ...(field ? { field } : {}), severity: "ERROR" }], policy: null, authority: null, schemaSnapshotId: null, registryVersion: null };
}

function ready(input: Omit<ApprovalReadiness, "status" | "code" | "message" | "failures">): ApprovalReadiness {
  return { status: "READY", code: "READY", message: "The revision satisfies deterministic approval readiness checks.", failures: [], ...input };
}

function toGovernanceError(error: unknown): SemanticGovernanceError {
  if (error instanceof SemanticGovernanceError) return error;
  if (error instanceof SemanticRepositoryError) return new SemanticGovernanceError(error.code, error.message);
  if (error instanceof SemanticValidationError) return new SemanticGovernanceError("SEMANTIC_CONTRACT_INVALID", "The semantic contract is not approval-ready.", error.field);
  return new SemanticGovernanceError("SEMANTIC_APPROVAL_VALIDATION_FAILED", "The semantic revision could not be validated deterministically.");
}

function assertCapability(user: AuthenticatedUser, capability: string): void {
  if (!hasCapability(user, capability)) throw new SemanticGovernanceError("RBAC_FORBIDDEN", "Your role is not allowed to perform this semantic governance action.");
}

export async function loadGovernanceAsset(database: D1Database, assetIdValue: string): Promise<SemanticGovernanceAsset> {
  const assetId = validateOpaqueId(assetIdValue, "assetId");
  const row = await database.prepare("SELECT asset_id, asset_type, domain, asset_status, current_approved_revision_id FROM semantic_assets WHERE asset_id = ?").bind(assetId).first<{ asset_id: string; asset_type: SemanticAssetType; domain: string; asset_status: "ACTIVE" | "DEPRECATED"; current_approved_revision_id: string | null }>();
  if (!row) throw new SemanticGovernanceError("SEMANTIC_ASSET_NOT_FOUND", "Semantic asset was not found.");
  return { assetId: row.asset_id, assetType: row.asset_type, domain: row.domain, assetStatus: row.asset_status, currentApprovedRevisionId: row.current_approved_revision_id };
}

export async function loadGovernanceRevision(database: D1Database, assetIdValue: string, revisionIdValue: string): Promise<SemanticGovernanceRevision> {
  const assetId = validateOpaqueId(assetIdValue, "assetId");
  const revisionId = validateOpaqueId(revisionIdValue, "revisionId");
  const row = await database.prepare("SELECT revision_id, asset_id, revision_number, revision_status, payload_json, schema_snapshot_id, created_by, submitted_by FROM semantic_revisions WHERE asset_id = ? AND revision_id = ?").bind(assetId, revisionId).first<RevisionRow>();
  if (!row) throw new SemanticGovernanceError("SEMANTIC_REVISION_NOT_FOUND", "Semantic revision was not found.");
  return { revisionId: row.revision_id, assetId: row.asset_id, revisionNumber: row.revision_number, revisionStatus: row.revision_status, payloadJson: row.payload_json, schemaSnapshotId: row.schema_snapshot_id, createdBy: row.created_by, submittedBy: row.submitted_by };
}

async function resolvePolicy(database: D1Database, asset: SemanticGovernanceAsset): Promise<PolicyRow> {
  const keys = [scopeKey("ASSET", asset.domain, asset.assetId), scopeKey("DOMAIN", asset.domain)];
  const row = await database.prepare("SELECT policy_id, scope_key, scope_kind, domain, asset_id, risk_class, required_approvals, allow_proposer_self_approval, allow_emergency_publication, post_review_due_hours FROM semantic_governance_policies WHERE is_active = 1 AND scope_key IN (?, ?) ORDER BY CASE scope_kind WHEN 'ASSET' THEN 0 ELSE 1 END LIMIT 1").bind(...keys).first<PolicyRow>();
  if (!row) throw new SemanticGovernanceError("SEMANTIC_APPROVAL_AUTHORITY_NOT_CONFIGURED", "No active semantic approval policy is configured for this asset or domain.");
  return row;
}

async function resolveAuthority(database: D1Database, asset: SemanticGovernanceAsset, actorId: string, action: SemanticGovernanceAction): Promise<AuthorityRow> {
  const assetKey = scopeKey("ASSET", asset.domain, asset.assetId);
  const domainKey = scopeKey("DOMAIN", asset.domain);
  const assetAuthorityCount = await database.prepare("SELECT COUNT(*) AS total FROM semantic_authorities WHERE scope_key = ? AND is_active = 1").bind(assetKey).first<{ total: number }>();
  const useAssetScope = (assetAuthorityCount?.total ?? 0) > 0;
  const requiredField = action === "APPROVE" || action === "EMERGENCY_PUBLISH" ? "can_approve" : "can_govern_runtime";
  const activeAuthorityCount = await database.prepare(`SELECT COUNT(*) AS total FROM semantic_authorities WHERE scope_key = ? AND is_active = 1 AND ${requiredField} = 1`).bind(useAssetScope ? assetKey : domainKey).first<{ total: number }>();
  if ((activeAuthorityCount?.total ?? 0) === 0) throw new SemanticGovernanceError("SEMANTIC_APPROVAL_AUTHORITY_NOT_CONFIGURED", "No active semantic authority is configured for this asset or domain.");
  const row = await database.prepare(`SELECT authority_id, scope_key, scope_kind, user_id, raci_role, can_approve, can_govern_runtime FROM semantic_authorities WHERE scope_key = ? AND user_id = ? AND is_active = 1 AND ${requiredField} = 1 ORDER BY CASE raci_role WHEN 'SEMANTIC_APPROVER' THEN 0 WHEN 'DATA_OWNER' THEN 1 ELSE 2 END LIMIT 1`).bind(useAssetScope ? assetKey : domainKey, actorId).first<AuthorityRow>();
  if (!row) throw new SemanticGovernanceError("SEMANTIC_AUTHORITY_FORBIDDEN", "The authenticated user lacks applicable semantic authority for this asset.");
  return row;
}

function contractFromRevision(asset: SemanticGovernanceAsset, revision: SemanticGovernanceRevision): { contract: SemanticContract; result: ReturnType<typeof validateContract> } {
  try {
    const result = validateContract(asset.assetType, JSON.parse(revision.payloadJson) as unknown);
    return { contract: result.contract, result };
  } catch (error) { throw toGovernanceError(error); }
}

async function assertAuthorizedReferences(result: ReturnType<typeof validateContract>, catalog: AuthorizedSemanticCatalog): Promise<void> {
  for (const source of result.normalizedSources) {
    if (source.sourceKind === "TABLE" && source.tableName && !catalog.tables.has(source.tableName.toLowerCase())) {
      throw new SemanticGovernanceError("SEMANTIC_SOURCE_NOT_AUTHORIZED", "A semantic source table is outside the approver's authorized catalog.");
    }
    if (source.sourceKind === "COLUMN" && source.tableName && source.columnName && !catalog.columns.has(`${source.tableName.toLowerCase()}\u0000${source.columnName.toLowerCase()}`)) {
      throw new SemanticGovernanceError("SEMANTIC_SOURCE_NOT_AUTHORIZED", "A semantic source column is outside the approver's authorized catalog.");
    }
  }
}

async function assertRelationshipReferences(database: D1Database, asset: SemanticGovernanceAsset, contract: SemanticContract): Promise<void> {
  if (asset.assetType !== "RELATIONSHIP") return;
  const relationship = contract as Extract<SemanticContract, { joinKeys: unknown }>;
  for (const key of relationship.joinKeys) {
    const forward = await database.prepare("SELECT 1 AS ok FROM schema_catalog_foreign_keys WHERE table_name = ? AND column_name = ? AND referenced_table = ? AND referenced_column = ? LIMIT 1").bind(key.leftTable, key.leftColumn, key.rightTable, key.rightColumn).first<{ ok: number }>();
    const reverse = await database.prepare("SELECT 1 AS ok FROM schema_catalog_foreign_keys WHERE table_name = ? AND column_name = ? AND referenced_table = ? AND referenced_column = ? LIMIT 1").bind(key.rightTable, key.rightColumn, key.leftTable, key.leftColumn).first<{ ok: number }>();
    const validDirection = relationship.cardinality === "ONE_TO_MANY" ? Boolean(reverse)
      : relationship.cardinality === "MANY_TO_ONE" ? Boolean(forward)
        : Boolean(forward || reverse);
    if (!validDirection) throw new SemanticGovernanceError("SEMANTIC_RELATIONSHIP_INVALID", "Relationship keys do not match a catalog foreign-key direction compatible with the declared cardinality.");
  }
}

async function assertAliasConflict(database: D1Database, asset: SemanticGovernanceAsset, revision: SemanticGovernanceRevision): Promise<void> {
  const row = await database.prepare("SELECT 1 AS conflict FROM semantic_aliases sa JOIN semantic_revisions sr ON sr.revision_id = sa.revision_id JOIN semantic_assets other ON other.asset_id = sr.asset_id JOIN semantic_aliases mine ON mine.revision_id = ? AND mine.normalized_alias = sa.normalized_alias AND mine.locale = sa.locale WHERE other.asset_id <> ? AND other.asset_type = ? AND other.domain = ? AND sr.revision_status = 'APPROVED' LIMIT 1").bind(revision.revisionId, asset.assetId, asset.assetType, asset.domain).first<{ conflict: number }>();
  if (row) throw new SemanticGovernanceError("SEMANTIC_ALIAS_CONFLICT", "An alias conflicts with an approved semantic in the same type and domain.");
}

async function assertNoDependencyCycle(database: D1Database, revisionId: string): Promise<void> {
  const visited = new Set<string>();
  const walk = async (current: string): Promise<void> => {
    const rows = (await database.prepare("SELECT referenced_revision_id FROM semantic_sources WHERE revision_id = ? AND source_kind = 'SEMANTIC_DEPENDENCY' ORDER BY ordinal_position").bind(current).all<{ referenced_revision_id: string }>()).results ?? [];
    for (const row of rows) {
      if (row.referenced_revision_id === revisionId) throw new SemanticGovernanceError("SEMANTIC_DEPENDENCY_CYCLE", "Semantic dependencies must not contain a cycle.");
      if (visited.has(row.referenced_revision_id)) continue;
      visited.add(row.referenced_revision_id);
      await walk(row.referenced_revision_id);
    }
  };
  await walk(revisionId);
}

async function approvalCount(database: D1Database, revisionId: string): Promise<number> {
  const row = await database.prepare("SELECT COUNT(DISTINCT actor_user_id) AS total FROM semantic_approval_decisions WHERE revision_id = ? AND decision = 'APPROVE'").bind(revisionId).first<{ total: number }>();
  return row?.total ?? 0;
}

export async function validateSemanticApprovalReadiness(
  database: D1Database,
  input: { actor: AuthenticatedUser; asset: SemanticGovernanceAsset; revision: SemanticGovernanceRevision; action: SemanticGovernanceAction; authorizedCatalog: AuthorizedSemanticCatalog },
): Promise<ApprovalReadiness> {
  try {
    const capability = input.action === "APPROVE" ? "approve_semantics"
      : input.action === "EMERGENCY_PUBLISH" ? "emergency_publish_semantics"
        : input.action === "SUSPEND_RUNTIME" ? "suspend_semantics_runtime"
          : input.action === "RESUME_RUNTIME" ? "resume_semantics_runtime" : "review_semantics";
    assertCapability(input.actor, capability);
    const policy = await resolvePolicy(database, input.asset);
    const authority = await resolveAuthority(database, input.asset, input.actor.id, input.action);
    const registryVersion = await getSemanticRegistryVersion(database);
    const currentSnapshot = await getSchemaSnapshotId(database);
    if (input.revision.schemaSnapshotId !== currentSnapshot || input.authorizedCatalog.schemaSnapshotId !== currentSnapshot) throw new SemanticGovernanceError("SEMANTIC_SCHEMA_STALE", "The semantic revision or authorized catalog is stale relative to the current schema snapshot.");
    if (input.asset.assetStatus !== "ACTIVE") throw new SemanticGovernanceError("SEMANTIC_ASSET_DEPRECATED", "A deprecated semantic asset cannot be published.");
    if (input.action === "APPROVE" || input.action === "EMERGENCY_PUBLISH" || input.action === "RESUME_RUNTIME") {
      if ((input.action === "APPROVE" || input.action === "EMERGENCY_PUBLISH") && input.revision.revisionStatus !== "IN_REVIEW") throw new SemanticGovernanceError("SEMANTIC_REVIEW_REQUIRED", "Only an IN_REVIEW semantic revision can be published.");
      if (input.action === "RESUME_RUNTIME" && input.revision.revisionStatus !== "APPROVED") throw new SemanticGovernanceError("SEMANTIC_RUNTIME_STATE_INVALID", "Only an approved semantic revision can resume runtime eligibility.");
      if (input.action === "EMERGENCY_PUBLISH" && !Boolean(policy.allow_emergency_publication)) throw new SemanticGovernanceError("SEMANTIC_EMERGENCY_NOT_ALLOWED", "Emergency publication is not enabled by the applicable semantic policy.");
      if (input.action === "APPROVE" && !Boolean(policy.allow_proposer_self_approval) && input.revision.createdBy === input.actor.id) throw new SemanticGovernanceError("SEMANTIC_SOD_SELF_APPROVAL_FORBIDDEN", "The proposer cannot approve this revision under the applicable policy.");
      const { contract, result } = contractFromRevision(input.asset, input.revision);
      await assertSemanticCatalogReferences(database, result);
      await assertAuthorizedReferences(result, input.authorizedCatalog);
      await assertPinnedDependencies(database, contract.semanticDependencies);
      await assertRelationshipReferences(database, input.asset, contract);
      await assertAliasConflict(database, input.asset, input.revision);
      await assertNoDependencyCycle(database, input.revision.revisionId);
    }
    const completed = await approvalCount(database, input.revision.revisionId);
    const includesActor = await database.prepare("SELECT 1 AS present FROM semantic_approval_decisions WHERE revision_id = ? AND actor_user_id = ? AND decision = 'APPROVE'").bind(input.revision.revisionId, input.actor.id).first<{ present: number }>();
    const predictedCompleted = input.action === "APPROVE" && !includesActor ? completed + 1 : completed;
    return ready({
      policy: { policyId: policy.policy_id, scopeKind: policy.scope_kind, riskClass: policy.risk_class, requiredApprovals: policy.required_approvals, completedApprovals: completed, remainingApprovals: Math.max(0, policy.required_approvals - completed), allowProposerSelfApproval: Boolean(policy.allow_proposer_self_approval), allowEmergencyPublication: Boolean(policy.allow_emergency_publication), postReviewDueHours: policy.post_review_due_hours },
      authority: { authorityId: authority.authority_id, scopeKind: authority.scope_kind, raciRole: authority.raci_role },
      schemaSnapshotId: currentSnapshot,
      registryVersion,
      ...(predictedCompleted < policy.required_approvals && input.action === "APPROVE" ? {} : {}),
    });
  } catch (error) {
    const normalized = toGovernanceError(error);
    return fail(normalized.code, normalized.message, normalized.field);
  }
}

export function requireReady(readiness: ApprovalReadiness): asserts readiness is ApprovalReadiness & { policy: NonNullable<ApprovalReadiness["policy"]>; authority: NonNullable<ApprovalReadiness["authority"]>; schemaSnapshotId: string; registryVersion: number } {
  if (readiness.status !== "READY" || !readiness.policy || !readiness.authority || !readiness.schemaSnapshotId || readiness.registryVersion === null) throw new SemanticGovernanceError(readiness.code, readiness.message);
}

function idempotencyKey(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_-]{8,128}$/u.test(value)) throw new SemanticGovernanceError("SEMANTIC_IDEMPOTENCY_KEY_INVALID", "idempotencyKey must be a bounded opaque key.");
  return value;
}

async function existingIdempotency(database: D1Database, actorId: string, operation: string, assetId: string, revisionId: string, key: string): Promise<boolean> {
  const row = await database.prepare("SELECT 1 AS present FROM semantic_governance_idempotency WHERE actor_user_id = ? AND operation = ? AND asset_id = ? AND revision_id = ? AND idempotency_key = ?").bind(actorId, operation, assetId, revisionId, key).first<{ present: number }>();
  return Boolean(row);
}

export async function approveSemanticRevision(database: D1Database, input: { actorId: string; asset: SemanticGovernanceAsset; revision: SemanticGovernanceRevision; readiness: ApprovalReadiness; idempotencyKey: unknown; comment?: unknown }): Promise<{ published: boolean; registryVersion: number; replayed: boolean }> {
  requireReady(input.readiness);
  const key = idempotencyKey(input.idempotencyKey);
  const comment = validateReviewComment(input.comment ?? "");
  const replayed = await existingIdempotency(database, input.actorId, "APPROVE", input.asset.assetId, input.revision.revisionId, key);
  if (replayed) return { published: input.revision.revisionStatus === "APPROVED", registryVersion: await getSemanticRegistryVersion(database), replayed: true };
  const decisionId = crypto.randomUUID();
  const commandId = crypto.randomUUID();
  const now = new Date().toISOString();
  const predicted = input.readiness.policy.completedApprovals + 1 >= input.readiness.policy.requiredApprovals;
  const statements: D1PreparedStatement[] = [
    database.prepare("INSERT INTO semantic_governance_idempotency (idempotency_id, actor_user_id, operation, asset_id, revision_id, idempotency_key, result_code, created_at) VALUES (?, ?, 'APPROVE', ?, ?, ?, 'ACCEPTED', ?)").bind(crypto.randomUUID(), input.actorId, input.asset.assetId, input.revision.revisionId, key, now),
    database.prepare("INSERT INTO semantic_approval_decisions (decision_id, revision_id, actor_user_id, decision, policy_id, authority_id, risk_class, approval_slot, comment, created_at) VALUES (?, ?, ?, 'APPROVE', ?, ?, ?, ?, ?, ?)").bind(decisionId, input.revision.revisionId, input.actorId, input.readiness.policy.policyId, input.readiness.authority.authorityId, input.readiness.policy.riskClass, input.readiness.policy.completedApprovals + 1, comment, now),
  ];
  if (predicted) statements.push(database.prepare("INSERT INTO semantic_publication_commands (command_id, asset_id, revision_id, actor_user_id, policy_id, authority_id, publication_mode, expected_registry_version, validator_version, emergency_reason, change_reference, review_due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'NORMAL', ?, ?, '', '', NULL, ?)").bind(commandId, input.asset.assetId, input.revision.revisionId, input.actorId, input.readiness.policy.policyId, input.readiness.authority.authorityId, input.readiness.registryVersion, SEMANTIC_APPROVAL_VALIDATOR_VERSION, now));
  try { await database.batch(statements); } catch { throw new SemanticGovernanceError("SEMANTIC_APPROVAL_CONFLICT", "Approval could not be committed because governance state changed concurrently."); }
  return { published: predicted, registryVersion: await getSemanticRegistryVersion(database), replayed: false };
}

export async function emergencyPublishSemanticRevision(database: D1Database, input: { actorId: string; asset: SemanticGovernanceAsset; revision: SemanticGovernanceRevision; readiness: ApprovalReadiness; idempotencyKey: unknown; reason: unknown; changeReference: unknown; reviewDueAt: unknown }): Promise<{ publicationId: string; registryVersion: number; replayed: boolean }> {
  requireReady(input.readiness);
  const key = idempotencyKey(input.idempotencyKey);
  const reason = validateReviewComment(input.reason, "reason");
  const changeReference = typeof input.changeReference === "string" && input.changeReference.trim().length <= 160 ? input.changeReference.trim() : "";
  const reviewDueAt = typeof input.reviewDueAt === "string" && Number.isFinite(Date.parse(input.reviewDueAt)) ? new Date(input.reviewDueAt).toISOString() : "";
  if (!reason || !changeReference || !reviewDueAt || Date.parse(reviewDueAt) <= Date.now()) throw new SemanticGovernanceError("SEMANTIC_EMERGENCY_CONTRACT_INVALID", "Emergency publication requires a reason, change reference, and future post-review deadline.");
  if (await existingIdempotency(database, input.actorId, "EMERGENCY_PUBLISH", input.asset.assetId, input.revision.revisionId, key)) {
    const existing = await database.prepare("SELECT publication_id FROM semantic_publications WHERE revision_id = ?").bind(input.revision.revisionId).first<{ publication_id: string }>();
    if (!existing) throw new SemanticGovernanceError("SEMANTIC_APPROVAL_CONFLICT", "The prior emergency publication did not complete.");
    return { publicationId: existing.publication_id, registryVersion: await getSemanticRegistryVersion(database), replayed: true };
  }
  const commandId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await database.batch([
      database.prepare("INSERT INTO semantic_governance_idempotency (idempotency_id, actor_user_id, operation, asset_id, revision_id, idempotency_key, result_code, created_at) VALUES (?, ?, 'EMERGENCY_PUBLISH', ?, ?, ?, 'ACCEPTED', ?)").bind(crypto.randomUUID(), input.actorId, input.asset.assetId, input.revision.revisionId, key, now),
      database.prepare("INSERT INTO semantic_approval_decisions (decision_id, revision_id, actor_user_id, decision, policy_id, authority_id, risk_class, approval_slot, comment, created_at) VALUES (?, ?, ?, 'EMERGENCY_PUBLISH', ?, ?, ?, 1, ?, ?)").bind(crypto.randomUUID(), input.revision.revisionId, input.actorId, input.readiness.policy.policyId, input.readiness.authority.authorityId, input.readiness.policy.riskClass, reason, now),
      database.prepare("INSERT INTO semantic_publication_commands (command_id, asset_id, revision_id, actor_user_id, policy_id, authority_id, publication_mode, expected_registry_version, validator_version, emergency_reason, change_reference, review_due_at, created_at) VALUES (?, ?, ?, ?, ?, ?, 'EMERGENCY', ?, ?, ?, ?, ?, ?)").bind(commandId, input.asset.assetId, input.revision.revisionId, input.actorId, input.readiness.policy.policyId, input.readiness.authority.authorityId, input.readiness.registryVersion, SEMANTIC_APPROVAL_VALIDATOR_VERSION, reason, changeReference, reviewDueAt, now),
    ]);
  } catch { throw new SemanticGovernanceError("SEMANTIC_EMERGENCY_CONFLICT", "Emergency publication could not be committed because governance state changed concurrently."); }
  return { publicationId: commandId, registryVersion: await getSemanticRegistryVersion(database), replayed: false };
}

export async function loadPublication(database: D1Database, revisionId: string): Promise<PublicationRow | null> {
  return database.prepare("SELECT publication_id, publication_mode, runtime_eligibility, post_review_status, schema_snapshot_id FROM semantic_publications WHERE revision_id = ?").bind(revisionId).first<PublicationRow>();
}

export async function governSemanticRuntime(database: D1Database, input: { actorId: string; action: "SUSPEND" | "RESUME" | "POST_REVIEW_CONFIRMED" | "POST_REVIEW_REQUIRES_CORRECTION"; asset: SemanticGovernanceAsset; revision: SemanticGovernanceRevision; readiness: ApprovalReadiness; idempotencyKey: unknown; reason?: unknown }): Promise<{ registryVersion: number; replayed: boolean }> {
  requireReady(input.readiness);
  const operation = input.action === "SUSPEND" ? "SUSPEND_RUNTIME" : input.action === "RESUME" ? "RESUME_RUNTIME" : "POST_REVIEW";
  const key = idempotencyKey(input.idempotencyKey);
  const reason = validateReviewComment(input.reason ?? "", "reason");
  const publication = await loadPublication(database, input.revision.revisionId);
  if (!publication) throw new SemanticGovernanceError("SEMANTIC_PUBLICATION_NOT_FOUND", "The approved semantic publication was not found.");
  if (await existingIdempotency(database, input.actorId, operation, input.asset.assetId, input.revision.revisionId, key)) return { registryVersion: await getSemanticRegistryVersion(database), replayed: true };
  const commandId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await database.batch([
      database.prepare("INSERT INTO semantic_governance_idempotency (idempotency_id, actor_user_id, operation, asset_id, revision_id, idempotency_key, result_code, created_at) VALUES (?, ?, ?, ?, ?, ?, 'ACCEPTED', ?)").bind(crypto.randomUUID(), input.actorId, operation, input.asset.assetId, input.revision.revisionId, key, now),
      database.prepare("INSERT INTO semantic_runtime_commands (command_id, publication_id, asset_id, revision_id, actor_user_id, authority_id, action, expected_registry_version, reason, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(commandId, publication.publication_id, input.asset.assetId, input.revision.revisionId, input.actorId, input.readiness.authority.authorityId, input.action, input.readiness.registryVersion, reason, now),
    ]);
  } catch { throw new SemanticGovernanceError("SEMANTIC_RUNTIME_CONFLICT", "Runtime eligibility could not be changed because governance state changed concurrently."); }
  return { registryVersion: await getSemanticRegistryVersion(database), replayed: false };
}

export async function createGovernancePolicy(database: D1Database, input: { actorId: string; scopeKind: "DOMAIN" | "ASSET"; domain: string; assetId?: string; riskClass: SemanticRiskClass; requiredApprovals: number; allowProposerSelfApproval: boolean; allowEmergencyPublication: boolean; postReviewDueHours: number }): Promise<{ policyId: string }> {
  const assetId = input.scopeKind === "ASSET" ? validateOpaqueId(input.assetId, "assetId") : null;
  if (!SEMANTIC_RISK_CLASSES.includes(input.riskClass) || !Number.isInteger(input.requiredApprovals) || input.requiredApprovals < 1 || input.requiredApprovals > 5 || !Number.isInteger(input.postReviewDueHours) || input.postReviewDueHours < 1 || input.postReviewDueHours > 720) throw new SemanticGovernanceError("SEMANTIC_GOVERNANCE_POLICY_INVALID", "Semantic governance policy fields are invalid.");
  if (input.scopeKind === "ASSET" && !assetId) throw new SemanticGovernanceError("SEMANTIC_GOVERNANCE_POLICY_INVALID", "Asset policy requires an assetId.");
  if ((input.riskClass === "HIGH" || input.riskClass === "CRITICAL") && input.requiredApprovals < 2) throw new SemanticGovernanceError("SEMANTIC_GOVERNANCE_POLICY_INVALID", "High and critical risk policies require at least two distinct human approvals.");
  const policyId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await database.prepare("INSERT INTO semantic_governance_policies (policy_id, scope_key, scope_kind, domain, asset_id, risk_class, required_approvals, allow_proposer_self_approval, allow_emergency_publication, post_review_due_hours, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)").bind(policyId, scopeKey(input.scopeKind, input.domain, assetId ?? undefined), input.scopeKind, input.domain, assetId, input.riskClass, input.requiredApprovals, Number(input.allowProposerSelfApproval), Number(input.allowEmergencyPublication), input.postReviewDueHours, input.actorId, now, now).run();
  } catch { throw new SemanticGovernanceError("SEMANTIC_GOVERNANCE_POLICY_CONFLICT", "A governance policy already exists for this scope."); }
  return { policyId };
}

export async function createSemanticAuthority(database: D1Database, input: { actorId: string; scopeKind: "DOMAIN" | "ASSET"; domain: string; assetId?: string; userId: string; raciRole: SemanticRaciRole; canApprove: boolean; canGovernRuntime: boolean }): Promise<{ authorityId: string }> {
  const assetId = input.scopeKind === "ASSET" ? validateOpaqueId(input.assetId, "assetId") : null;
  const userId = validateOpaqueId(input.userId, "userId");
  if (!SEMANTIC_RACI_ROLES.includes(input.raciRole) || (input.raciRole !== "SEMANTIC_APPROVER" && input.canApprove)) throw new SemanticGovernanceError("SEMANTIC_AUTHORITY_INVALID", "Only an explicitly configured Semantic Approver may receive approval authority.");
  const activeUser = await database.prepare("SELECT 1 AS active FROM users WHERE id = ? AND is_active = 1").bind(userId).first<{ active: number }>();
  if (!activeUser) throw new SemanticGovernanceError("SEMANTIC_AUTHORITY_INVALID", "Semantic authority must reference an active human user.");
  const authorityId = crypto.randomUUID();
  const now = new Date().toISOString();
  try {
    await database.prepare("INSERT INTO semantic_authorities (authority_id, scope_key, scope_kind, domain, asset_id, user_id, raci_role, can_approve, can_govern_runtime, is_active, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)").bind(authorityId, scopeKey(input.scopeKind, input.domain, assetId ?? undefined), input.scopeKind, input.domain, assetId, userId, input.raciRole, Number(input.canApprove), Number(input.canGovernRuntime), input.actorId, now, now).run();
  } catch { throw new SemanticGovernanceError("SEMANTIC_AUTHORITY_CONFLICT", "This authority assignment already exists."); }
  return { authorityId };
}

export async function listGovernanceConfig(database: D1Database): Promise<{ policies: Record<string, unknown>[]; authorities: Record<string, unknown>[] }> {
  const [policies, authorities] = await Promise.all([
    database.prepare("SELECT policy_id, scope_kind, domain, asset_id, risk_class, required_approvals, allow_proposer_self_approval, allow_emergency_publication, post_review_due_hours, is_active, created_at, updated_at FROM semantic_governance_policies ORDER BY scope_kind, domain, created_at").all<Record<string, unknown>>(),
    database.prepare("SELECT authority_id, scope_kind, domain, asset_id, user_id, raci_role, can_approve, can_govern_runtime, is_active, created_at, updated_at FROM semantic_authorities ORDER BY scope_kind, domain, raci_role, created_at").all<Record<string, unknown>>(),
  ]);
  return { policies: policies.results ?? [], authorities: authorities.results ?? [] };
}
