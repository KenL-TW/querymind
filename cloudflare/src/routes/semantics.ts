import { requireBrowserSession, requireCapability, requireUser } from "../lib/auth";
import { auditSemantic } from "../lib/audit";
import { HttpError, json, readJson } from "../lib/http";
import { objectBody, optionalText, page } from "../lib/product";
import { authorizedSchemaCatalog } from "../lib/schema-catalog";
import { resolveEffectiveScope } from "../lib/scope";
import {
  approveSemanticRevision,
  createGovernancePolicy,
  createSemanticAuthority,
  emergencyPublishSemanticRevision,
  governSemanticRuntime,
  listGovernanceConfig,
  loadGovernanceAsset,
  loadGovernanceRevision,
  loadPublication,
  requireReady,
  SEMANTIC_RACI_ROLES,
  SEMANTIC_RISK_CLASSES,
  SemanticGovernanceError,
  validateSemanticApprovalReadiness,
  type AuthorizedSemanticCatalog,
  type SemanticGovernanceAction,
} from "../lib/semantic-governance";
import {
  assertPinnedDependencies,
  assertSemanticCatalogReferences,
  createSemanticAsset,
  createSemanticRevision,
  getSchemaSnapshotId,
  readSemanticRevision,
  rejectSemanticRevision,
  requestSemanticChanges,
  SemanticRepositoryError,
  submitSemanticRevision,
  updateDraftRevision,
} from "../lib/semantic-repository";
import {
  SemanticValidationError,
  SEMANTIC_LIMITS,
  validateAliases,
  validateAssetName,
  validateBoundedText,
  validateContract,
  validateOpaqueId,
  validateReviewComment,
} from "../lib/semantic-validation";
import {
  SEMANTIC_ASSET_STATUSES,
  SEMANTIC_ASSET_TYPES,
  SEMANTIC_REVISION_STATUSES,
  type SemanticAssetType,
  type SemanticContract,
  type SemanticRevisionStatus,
} from "../lib/semantic-types";

const SEMANTIC_REQUEST_BYTES = 64_000;
const LIST_LIMIT = 100;

type JsonRecord = Record<string, unknown>;

interface AssetListRow {
  asset_id: string;
  asset_type: SemanticAssetType;
  canonical_name: string;
  display_name: string;
  domain: string;
  owner_user_id: string;
  asset_status: "ACTIVE" | "DEPRECATED";
  current_approved_revision_id: string | null;
  current_approved_revision_number: number | null;
  latest_revision_id: string | null;
  latest_revision_number: number | null;
  latest_revision_status: SemanticRevisionStatus | null;
}

interface AssetRow {
  asset_id: string;
  asset_type: SemanticAssetType;
  canonical_name: string;
  display_name: string;
  domain: string;
  description: string;
  owner_user_id: string;
  asset_status: "ACTIVE" | "DEPRECATED";
  current_approved_revision_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  deprecated_at: string | null;
}

interface RevisionApiRow {
  revision_id: string;
  asset_id: string;
  asset_type: SemanticAssetType;
  revision_number: number;
  revision_status: SemanticRevisionStatus;
  payload_json: string;
  schema_snapshot_id: string;
  change_reason: string;
  created_by: string;
  created_at: string;
  submitted_by: string | null;
  submitted_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
}

interface SourceRow {
  source_id: string;
  source_kind: "TABLE" | "COLUMN" | "SEMANTIC_DEPENDENCY";
  table_name: string | null;
  column_name: string | null;
  referenced_asset_id: string | null;
  referenced_revision_id: string | null;
  role: string;
  ordinal_position: number;
}

interface AliasRow {
  alias_id: string;
  alias: string;
  normalized_alias: string;
  locale: string;
}

interface RelationshipKeyRow {
  ordinal_position: number;
  left_table: string;
  left_column: string;
  right_table: string;
  right_column: string;
}

interface ReviewRow {
  review_id: string;
  revision_id: string;
  action: "SUBMITTED" | "APPROVED" | "REJECTED" | "REQUEST_CHANGES" | "DEPRECATED";
  reviewer_user_id: string;
  comment: string;
  created_at: string;
}

function semanticError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (error instanceof SemanticGovernanceError) {
    const status = error.code === "RBAC_FORBIDDEN" || error.code === "SEMANTIC_AUTHORITY_FORBIDDEN" || error.code === "SEMANTIC_SOURCE_NOT_AUTHORIZED" ? 403
      : error.code === "SEMANTIC_ASSET_NOT_FOUND" || error.code === "SEMANTIC_REVISION_NOT_FOUND" || error.code === "SEMANTIC_PUBLICATION_NOT_FOUND" ? 404
        : error.code.includes("CONFLICT") || error.code.includes("REQUIRED") || error.code.includes("IMMUTABLE") || error.code.includes("STALE") || error.code.includes("NOT_CONFIGURED") ? 409
          : 400;
    throw new HttpError(status, error.code, error.message);
  }
  if (error instanceof SemanticValidationError) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "Semantic input is invalid.");
  if (error instanceof SemanticRepositoryError) {
    const status = error.code === "SEMANTIC_ASSET_NOT_FOUND" || error.code === "SEMANTIC_REVISION_NOT_FOUND" ? 404
      : error.code === "SEMANTIC_DUPLICATE_NAME" ? 409
        : error.code === "SEMANTIC_CATALOG_REFERENCE_INVALID" || error.code === "SEMANTIC_DEPENDENCY_NOT_APPROVED" || error.code === "SEMANTIC_SCHEMA_STALE" ? 400
          : error.code === "SCHEMA_SNAPSHOT_UNAVAILABLE" ? 409
            : error.code === "SEMANTIC_REVISION_IMMUTABLE" || error.code === "SEMANTIC_ASSET_DEPRECATED" || error.code.endsWith("_CONFLICT") ? 409
              : error.code === "SEMANTIC_REGISTRY_UNAVAILABLE" ? 503 : 400;
    const code = error.code === "SEMANTIC_ASSET_NOT_FOUND" ? "SEMANTIC_NOT_FOUND"
      : error.code === "SEMANTIC_REVISION_NOT_FOUND" ? "SEMANTIC_REVISION_NOT_FOUND"
        : error.code === "SCHEMA_SNAPSHOT_UNAVAILABLE" ? "SEMANTIC_SCHEMA_UNAVAILABLE"
          : error.code === "SEMANTIC_CATALOG_REFERENCE_INVALID" ? "SEMANTIC_VALIDATION_ERROR"
            : error.code === "SEMANTIC_REVISION_IMMUTABLE" || error.code === "SEMANTIC_ASSET_DEPRECATED" ? "SEMANTIC_STATE_CONFLICT"
              : error.code.endsWith("_CONFLICT") ? "SEMANTIC_STATE_CONFLICT" : error.code;
    throw new HttpError(status, code, error.message);
  }
  const message = error instanceof Error ? error.message : "";
  if (/UNIQUE constraint failed:\s*semantic_assets/iu.test(message)) throw new HttpError(409, "SEMANTIC_DUPLICATE_NAME", "A semantic asset with this canonical identity already exists.");
  if (/UNIQUE constraint failed:\s*semantic_revisions/iu.test(message)) throw new HttpError(409, "SEMANTIC_REVISION_CONFLICT", "The semantic revision number changed concurrently.");
  throw error;
}

async function governed<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { return semanticError(error); }
}

function allowedObject(value: unknown, allowed: readonly string[]): JsonRecord {
  const body = objectBody(value);
  const keys = new Set(allowed);
  for (const key of Object.keys(body)) if (!keys.has(key)) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", `Unsupported semantic field: ${key}.`);
  return body;
}

async function semanticBody(request: Request, allowed: readonly string[]): Promise<JsonRecord> {
  const contentType = request.headers.get("content-type")?.toLowerCase() ?? "";
  if (!contentType.startsWith("application/json")) throw new HttpError(415, "SEMANTIC_CONTENT_TYPE_REQUIRED", "Semantic mutations require application/json.");
  return allowedObject(await readJson(request, SEMANTIC_REQUEST_BYTES), allowed);
}

function assetType(value: unknown): SemanticAssetType {
  if (typeof value !== "string" || !SEMANTIC_ASSET_TYPES.includes(value as SemanticAssetType)) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "assetType is invalid.");
  return value as SemanticAssetType;
}

function revisionStatus(value: string | null): SemanticRevisionStatus | null {
  if (!value) return null;
  if (!SEMANTIC_REVISION_STATUSES.includes(value as SemanticRevisionStatus)) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "revisionStatus is invalid.");
  return value as SemanticRevisionStatus;
}

function assetStatus(value: string | null): "ACTIVE" | "DEPRECATED" | null {
  if (!value) return null;
  if (!SEMANTIC_ASSET_STATUSES.includes(value as "ACTIVE" | "DEPRECATED")) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "assetStatus is invalid.");
  return value as "ACTIVE" | "DEPRECATED";
}

function parseStoredContract(row: RevisionApiRow): SemanticContract {
  try {
    const parsed = JSON.parse(row.payload_json) as unknown;
    return validateContract(row.asset_type, parsed).contract;
  } catch (error) {
    if (error instanceof SemanticValidationError || error instanceof SyntaxError) throw new HttpError(500, "SEMANTIC_DATA_INVALID", "Stored semantic revision data is invalid.");
    throw error;
  }
}

function revisionMetadata(row: RevisionApiRow): Record<string, unknown> {
  return {
    revisionId: row.revision_id,
    revisionNumber: row.revision_number,
    status: row.revision_status,
    schemaSnapshotId: row.schema_snapshot_id,
    changeReason: row.change_reason,
    createdBy: row.created_by,
    createdAt: row.created_at,
    submittedBy: row.submitted_by,
    submittedAt: row.submitted_at,
    approvedBy: row.approved_by,
    approvedAt: row.approved_at,
  };
}

function revisionReference(row: { revision_id: string | null; revision_number: number | null; revision_status?: SemanticRevisionStatus | null } | null): Record<string, unknown> | null {
  if (!row?.revision_id || row.revision_number === null) return null;
  return { revisionId: row.revision_id, revisionNumber: row.revision_number, ...(row.revision_status ? { status: row.revision_status } : {}) };
}

function assetListItem(row: AssetListRow): Record<string, unknown> {
  return {
    assetId: row.asset_id,
    assetType: row.asset_type,
    canonicalName: row.canonical_name,
    displayName: row.display_name,
    domain: row.domain,
    ownerUserId: row.owner_user_id,
    assetStatus: row.asset_status,
    currentApprovedRevision: revisionReference({ revision_id: row.current_approved_revision_id, revision_number: row.current_approved_revision_number }),
    latestRevision: revisionReference({ revision_id: row.latest_revision_id, revision_number: row.latest_revision_number, revision_status: row.latest_revision_status }),
  };
}

function escapeLike(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

function aliasInputs(value: unknown): Array<{ alias: string; locale?: string }> {
  return validateAliases(value).map((alias) => ({ alias: alias.alias, locale: alias.locale }));
}

function booleanField(value: unknown, field: string): boolean {
  if (typeof value !== "boolean") throw new HttpError(400, "SEMANTIC_GOVERNANCE_INVALID", `${field} must be a boolean.`);
  return value;
}

function integerField(value: unknown, field: string, minimum: number, maximum: number): number {
  if (!Number.isInteger(value) || Number(value) < minimum || Number(value) > maximum) throw new HttpError(400, "SEMANTIC_GOVERNANCE_INVALID", `${field} must be an integer between ${minimum} and ${maximum}.`);
  return Number(value);
}

function governanceScopeKind(value: unknown): "DOMAIN" | "ASSET" {
  if (value !== "DOMAIN" && value !== "ASSET") throw new HttpError(400, "SEMANTIC_GOVERNANCE_INVALID", "scopeKind must be DOMAIN or ASSET.");
  return value;
}

function governanceCatalog(value: Awaited<ReturnType<typeof authorizedSchemaCatalog>>): AuthorizedSemanticCatalog {
  return {
    schemaSnapshotId: value.schemaSnapshotId,
    tables: new Set(value.tables.map((table) => table.name.toLowerCase())),
    columns: new Set(value.tables.flatMap((table) => table.columns.map((column) => `${table.name.toLowerCase()}\u0000${column.name.toLowerCase()}`))),
  };
}

async function approvalReadinessContext(env: Env, user: Awaited<ReturnType<typeof requireUser>>, assetId: string, revisionId: string, action: SemanticGovernanceAction) {
  // Resolve EffectiveScope before obtaining any catalog evidence. The
  // governance validator receives only this authorized metadata projection.
  const scope = await resolveEffectiveScope(env, user);
  const catalog = governanceCatalog(await authorizedSchemaCatalog(env, scope));
  const asset = await loadGovernanceAsset(env.QUERYMIND_APP, assetId);
  const revision = await loadGovernanceRevision(env.QUERYMIND_APP, asset.assetId, revisionId);
  const readiness = await validateSemanticApprovalReadiness(env.QUERYMIND_APP, { actor: user, asset, revision, action, authorizedCatalog: catalog });
  return { asset, revision, readiness };
}

async function loadAsset(database: D1Database, assetIdValue: string): Promise<AssetRow> {
  const assetId = validateOpaqueId(assetIdValue, "assetId");
  const row = await database.prepare("SELECT asset_id, asset_type, canonical_name, display_name, domain, description, owner_user_id, asset_status, current_approved_revision_id, created_by, created_at, updated_at, deprecated_at FROM semantic_assets WHERE asset_id = ?").bind(assetId).first<AssetRow>();
  if (!row) throw new SemanticRepositoryError("SEMANTIC_ASSET_NOT_FOUND", "Semantic asset was not found.");
  return row;
}

async function loadRevision(database: D1Database, assetIdValue: string, revisionIdValue: string): Promise<RevisionApiRow> {
  const assetId = validateOpaqueId(assetIdValue, "assetId");
  const revisionId = validateOpaqueId(revisionIdValue, "revisionId");
  const row = await database.prepare("SELECT r.revision_id, r.asset_id, a.asset_type, r.revision_number, r.revision_status, r.payload_json, r.schema_snapshot_id, r.change_reason, r.created_by, r.created_at, r.submitted_by, r.submitted_at, r.approved_by, r.approved_at FROM semantic_revisions r JOIN semantic_assets a ON a.asset_id = r.asset_id WHERE r.asset_id = ? AND r.revision_id = ?").bind(assetId, revisionId).first<RevisionApiRow>();
  if (!row) throw new SemanticRepositoryError("SEMANTIC_REVISION_NOT_FOUND", "Semantic revision was not found.");
  return row;
}

async function currentSnapshot(database: D1Database): Promise<string> {
  return getSchemaSnapshotId(database);
}

async function validateWriteContract(database: D1Database, type: SemanticAssetType, value: unknown): Promise<{ contract: SemanticContract; payloadJson: string; schemaSnapshotId: string }> {
  const result = validateContract(type, value);
  await assertSemanticCatalogReferences(database, result);
  return { contract: result.contract, payloadJson: result.payloadJson, schemaSnapshotId: await currentSnapshot(database) };
}

async function assertOwnerExists(database: D1Database, ownerUserId: string): Promise<void> {
  const row = await database.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").bind(ownerUserId).first<{ id: string }>();
  if (!row) throw new HttpError(400, "SEMANTIC_OWNER_INVALID", "ownerUserId must reference an active user.");
}

export async function listSemantics(request: Request, env: Env): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireCapability(user, "view_semantics");
    const url = new URL(request.url);
    const type = url.searchParams.get("type");
    const status = assetStatus(url.searchParams.get("assetStatus"));
    const latestStatus = revisionStatus(url.searchParams.get("revisionStatus"));
    const domain = optionalText(url.searchParams.get("domain") ?? undefined, "domain", SEMANTIC_LIMITS.domain);
    const owner = url.searchParams.get("owner") ? validateOpaqueId(url.searchParams.get("owner"), "owner") : null;
    const search = optionalText(url.searchParams.get("search") ?? undefined, "search", 120);
    const pageNumber = page(url.searchParams.get("page"), 1, 100);
    const limit = page(url.searchParams.get("limit"), 50, LIST_LIMIT);
    const conditions = ["1 = 1"];
    const values: unknown[] = [];
    if (type !== null) { conditions.push("a.asset_type = ?"); values.push(assetType(type)); }
    if (status) { conditions.push("a.asset_status = ?"); values.push(status); }
    if (latestStatus) { conditions.push("latest.revision_status = ?"); values.push(latestStatus); }
    if (domain !== undefined) { conditions.push("a.domain = ?"); values.push(domain); }
    if (owner) { conditions.push("a.owner_user_id = ?"); values.push(owner); }
    if (search !== undefined) {
      const pattern = `%${escapeLike(search)}%`;
      conditions.push("(a.canonical_name LIKE ? ESCAPE '\\' OR a.display_name LIKE ? ESCAPE '\\' OR a.domain LIKE ? ESCAPE '\\')");
      values.push(pattern, pattern, pattern);
    }
    const from = `FROM semantic_assets a LEFT JOIN semantic_revisions latest ON latest.asset_id = a.asset_id AND latest.revision_number = (SELECT MAX(r2.revision_number) FROM semantic_revisions r2 WHERE r2.asset_id = a.asset_id) LEFT JOIN semantic_revisions approved ON approved.revision_id = a.current_approved_revision_id WHERE ${conditions.join(" AND ")}`;
    const count = await env.QUERYMIND_APP.prepare(`SELECT COUNT(*) AS total ${from}`).bind(...values).first<{ total: number }>();
    const offset = (pageNumber - 1) * limit;
    const rows = (await env.QUERYMIND_APP.prepare(`SELECT a.asset_id, a.asset_type, a.canonical_name, a.display_name, a.domain, a.owner_user_id, a.asset_status, a.current_approved_revision_id, approved.revision_number AS current_approved_revision_number, latest.revision_id AS latest_revision_id, latest.revision_number AS latest_revision_number, latest.revision_status AS latest_revision_status ${from} ORDER BY a.updated_at DESC, a.asset_id ASC LIMIT ? OFFSET ?`).bind(...values, limit, offset).all<AssetListRow>()).results ?? [];
    const total = count?.total ?? 0;
    return json({ items: rows.map(assetListItem), page: { page: pageNumber, limit, total, hasNext: offset + rows.length < total } });
  });
}

export async function getSemantic(request: Request, env: Env, assetId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireCapability(user, "view_semantics");
    const asset = await loadAsset(env.QUERYMIND_APP, assetId);
    const latest = await env.QUERYMIND_APP.prepare("SELECT r.revision_id, r.asset_id, a.asset_type, r.revision_number, r.revision_status, r.payload_json, r.schema_snapshot_id, r.change_reason, r.created_by, r.created_at, r.submitted_by, r.submitted_at, r.approved_by, r.approved_at FROM semantic_revisions r JOIN semantic_assets a ON a.asset_id = r.asset_id WHERE r.asset_id = ? ORDER BY r.revision_number DESC LIMIT 1").bind(asset.asset_id).first<RevisionApiRow>();
    if (!latest) throw new SemanticRepositoryError("SEMANTIC_REVISION_NOT_FOUND", "Semantic revision was not found.");
    const contract = parseStoredContract(latest);
    const [sources, aliases, relationshipKeys] = await Promise.all([
      env.QUERYMIND_APP.prepare("SELECT source_id, source_kind, table_name, column_name, referenced_asset_id, referenced_revision_id, role, ordinal_position FROM semantic_sources WHERE revision_id = ? ORDER BY ordinal_position").bind(latest.revision_id).all<SourceRow>(),
      env.QUERYMIND_APP.prepare("SELECT alias_id, alias, normalized_alias, locale FROM semantic_aliases WHERE revision_id = ? ORDER BY normalized_alias, locale").bind(latest.revision_id).all<AliasRow>(),
      env.QUERYMIND_APP.prepare("SELECT ordinal_position, left_table, left_column, right_table, right_column FROM semantic_relationship_keys WHERE revision_id = ? ORDER BY ordinal_position").bind(latest.revision_id).all<RelationshipKeyRow>(),
    ]);
    const approved = asset.current_approved_revision_id ? await readSemanticRevision(env.QUERYMIND_APP, asset.current_approved_revision_id) : null;
    return json({
      asset: { assetId: asset.asset_id, assetType: asset.asset_type, canonicalName: asset.canonical_name, displayName: asset.display_name, domain: asset.domain, description: asset.description, ownerUserId: asset.owner_user_id, assetStatus: asset.asset_status, createdBy: asset.created_by, createdAt: asset.created_at, updatedAt: asset.updated_at, deprecatedAt: asset.deprecated_at },
      currentApprovedRevision: approved ? { revisionId: approved.revisionId, revisionNumber: approved.revisionNumber, status: approved.revisionStatus, schemaSnapshotId: approved.schemaSnapshotId, createdAt: approved.createdAt, approvedBy: approved.approvedBy, approvedAt: approved.approvedAt } : null,
      latestRevision: { ...revisionMetadata(latest), contract },
      aliases: (aliases.results ?? []).map((row) => ({ aliasId: row.alias_id, alias: row.alias, normalizedAlias: row.normalized_alias, locale: row.locale })),
      normalizedSources: (sources.results ?? []).map((row) => ({ sourceKind: row.source_kind, tableName: row.table_name, columnName: row.column_name, referencedAssetId: row.referenced_asset_id, referencedRevisionId: row.referenced_revision_id, role: row.role, ordinalPosition: row.ordinal_position })),
      relationshipKeys: (relationshipKeys.results ?? []).map((row) => ({ ordinalPosition: row.ordinal_position, leftTable: row.left_table, leftColumn: row.left_column, rightTable: row.right_table, rightColumn: row.right_column })),
    });
  });
}

export async function createSemantic(request: Request, env: Env): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const body = await semanticBody(request, ["assetType", "canonicalName", "displayName", "domain", "description", "ownerUserId", "contract", "aliases", "changeReason"]);
    const type = assetType(body.assetType);
    const canonicalName = validateAssetName(body.canonicalName, "canonicalName");
    const displayName = validateBoundedText(body.displayName, "displayName", SEMANTIC_LIMITS.displayName, true);
    const ownerUserId = body.ownerUserId === undefined ? user.id : validateOpaqueId(body.ownerUserId, "ownerUserId");
    await assertOwnerExists(env.QUERYMIND_APP, ownerUserId);
    const validated = await validateWriteContract(env.QUERYMIND_APP, type, body.contract);
    const aliases = aliasInputs(body.aliases);
    const result = await createSemanticAsset(env.QUERYMIND_APP, { assetType: type, canonicalName, displayName, domain: optionalText(body.domain, "domain", SEMANTIC_LIMITS.domain), description: optionalText(body.description, "description", SEMANTIC_LIMITS.definition), ownerUserId, createdBy: user.id, schemaSnapshotId: validated.schemaSnapshotId, changeReason: optionalText(body.changeReason, "changeReason", 1000), contract: validated.contract, aliases });
    await auditSemantic(env, { actorId: user.id, eventType: "semantic.asset.created", resourceType: "semantic_asset", resourceId: result.assetId, metadata: { assetId: result.assetId, revisionId: result.revisionId, assetType: type, revisionNumber: result.revisionNumber, schemaSnapshotId: validated.schemaSnapshotId } });
    return json({ assetId: result.assetId, revisionId: result.revisionId, revisionNumber: result.revisionNumber, status: "DRAFT" }, 201);
  });
}

export async function createSemanticRevisionApi(request: Request, env: Env, assetId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const body = await semanticBody(request, ["contract", "aliases", "changeReason"]);
    const asset = await loadAsset(env.QUERYMIND_APP, assetId);
    const validated = await validateWriteContract(env.QUERYMIND_APP, asset.asset_type, body.contract);
    const result = await createSemanticRevision(env.QUERYMIND_APP, { assetId: asset.asset_id, createdBy: user.id, schemaSnapshotId: validated.schemaSnapshotId, changeReason: optionalText(body.changeReason, "changeReason", 1000), contract: validated.contract, aliases: aliasInputs(body.aliases) });
    await auditSemantic(env, { actorId: user.id, eventType: "semantic.revision.created", resourceType: "semantic_revision", resourceId: result.revisionId, metadata: { assetId: asset.asset_id, revisionId: result.revisionId, assetType: asset.asset_type, revisionNumber: result.revisionNumber, schemaSnapshotId: validated.schemaSnapshotId } });
    return json({ assetId: asset.asset_id, revisionId: result.revisionId, revisionNumber: result.revisionNumber, status: "DRAFT" }, 201);
  });
}

export async function patchSemanticRevision(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const body = await semanticBody(request, ["contract", "aliases", "changeReason"]);
    const asset = await loadAsset(env.QUERYMIND_APP, assetId);
    const current = await loadRevision(env.QUERYMIND_APP, asset.asset_id, revisionId);
    if (current.revision_status !== "DRAFT") throw new SemanticRepositoryError("SEMANTIC_REVISION_IMMUTABLE", "Only DRAFT revisions can be edited.");
    const validated = await validateWriteContract(env.QUERYMIND_APP, asset.asset_type, body.contract);
    await updateDraftRevision(env.QUERYMIND_APP, { revisionId: current.revision_id, schemaSnapshotId: validated.schemaSnapshotId, changeReason: optionalText(body.changeReason, "changeReason", 1000), contract: validated.contract, aliases: aliasInputs(body.aliases) });
    await auditSemantic(env, { actorId: user.id, eventType: "semantic.revision.updated", resourceType: "semantic_revision", resourceId: current.revision_id, metadata: { assetId: asset.asset_id, revisionId: current.revision_id, assetType: asset.asset_type, revisionNumber: current.revision_number, schemaSnapshotId: validated.schemaSnapshotId } });
    return json({ assetId: asset.asset_id, revisionId: current.revision_id, revisionNumber: current.revision_number, status: "DRAFT" });
  });
}

export async function submitSemanticReview(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const asset = await loadAsset(env.QUERYMIND_APP, assetId);
    const revision = await loadRevision(env.QUERYMIND_APP, asset.asset_id, revisionId);
    if (revision.revision_status !== "DRAFT") throw new SemanticRepositoryError("SEMANTIC_REVIEW_CONFLICT", "Only a DRAFT revision can be submitted for review.");
    const contract = parseStoredContract(revision);
    const result = validateContract(asset.asset_type, contract);
    await assertSemanticCatalogReferences(env.QUERYMIND_APP, result);
    await assertPinnedDependencies(env.QUERYMIND_APP, contract.semanticDependencies);
    const snapshot = await currentSnapshot(env.QUERYMIND_APP);
    if (revision.schema_snapshot_id !== snapshot) throw new SemanticRepositoryError("SEMANTIC_SCHEMA_STALE", "The revision was authored against a stale schema snapshot.");
    await submitSemanticRevision(env.QUERYMIND_APP, revision.revision_id, user.id);
    await auditSemantic(env, { actorId: user.id, eventType: "semantic.review.submitted", resourceType: "semantic_review", resourceId: revision.revision_id, metadata: { assetId: asset.asset_id, revisionId: revision.revision_id, assetType: asset.asset_type, revisionNumber: revision.revision_number, action: "SUBMITTED", schemaSnapshotId: snapshot } });
    return json({ assetId: asset.asset_id, revisionId: revision.revision_id, status: "IN_REVIEW" });
  });
}

async function reviewTransition(request: Request, env: Env, assetId: string, revisionId: string, action: "REQUEST_CHANGES" | "REJECTED"): Promise<Response> {
  const user = await requireUser(request, env);
  requireBrowserSession(user);
  requireCapability(user, "review_semantics");
  const body = await semanticBody(request, ["comment", "reason"]);
  if (body.comment === undefined && body.reason === undefined) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "A bounded review comment is required.");
  const comment = validateReviewComment(body.comment ?? body.reason, "comment");
  if (!comment) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "A bounded review comment is required.");
  const asset = await loadAsset(env.QUERYMIND_APP, assetId);
  const revision = await loadRevision(env.QUERYMIND_APP, asset.asset_id, revisionId);
  const reviewId = action === "REQUEST_CHANGES"
    ? await requestSemanticChanges(env.QUERYMIND_APP, { revisionId: revision.revision_id, reviewerUserId: user.id, comment })
    : await rejectSemanticRevision(env.QUERYMIND_APP, { revisionId: revision.revision_id, reviewerUserId: user.id, comment });
  await auditSemantic(env, { actorId: user.id, eventType: action === "REQUEST_CHANGES" ? "semantic.review.request_changes" : "semantic.review.rejected", resourceType: "semantic_review", resourceId: reviewId, metadata: { assetId: asset.asset_id, revisionId: revision.revision_id, assetType: asset.asset_type, revisionNumber: revision.revision_number, action } });
  return json({ assetId: asset.asset_id, revisionId: revision.revision_id, reviewId, status: action === "REQUEST_CHANGES" ? "DRAFT" : "REJECTED" });
}

export async function requestSemanticChangesApi(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(() => reviewTransition(request, env, assetId, revisionId, "REQUEST_CHANGES"));
}

export async function rejectSemanticApi(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(() => reviewTransition(request, env, assetId, revisionId, "REJECTED"));
}

export async function listSemanticRevisions(request: Request, env: Env, assetId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireCapability(user, "view_semantics");
    const asset = await loadAsset(env.QUERYMIND_APP, assetId);
    const limit = page(new URL(request.url).searchParams.get("limit"), 50, LIST_LIMIT);
    const rows = (await env.QUERYMIND_APP.prepare("SELECT revision_id, asset_id, revision_number, revision_status, payload_json, schema_snapshot_id, change_reason, created_by, created_at, submitted_by, submitted_at, approved_by, approved_at FROM semantic_revisions WHERE asset_id = ? ORDER BY revision_number DESC LIMIT ?").bind(asset.asset_id, limit).all<RevisionApiRow>()).results ?? [];
    return json({ assetId: asset.asset_id, items: rows.map(revisionMetadata) });
  });
}

export async function listSemanticReviews(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireCapability(user, "review_semantics");
    const asset = await loadAsset(env.QUERYMIND_APP, assetId);
    const revision = await loadRevision(env.QUERYMIND_APP, asset.asset_id, revisionId);
    const limit = page(new URL(request.url).searchParams.get("limit"), 50, LIST_LIMIT);
    const rows = (await env.QUERYMIND_APP.prepare("SELECT review_id, revision_id, action, reviewer_user_id, comment, created_at FROM semantic_reviews WHERE revision_id = ? ORDER BY created_at DESC LIMIT ?").bind(revision.revision_id, limit).all<ReviewRow>()).results ?? [];
    return json({ assetId: asset.asset_id, revisionId: revision.revision_id, items: rows.map((row) => ({ reviewId: row.review_id, revisionId: row.revision_id, action: row.action, reviewerUserId: row.reviewer_user_id, comment: row.comment, createdAt: row.created_at })) });
  });
}

/** P2-E: a governance administrator configures policy without receiving approval authority. */
export async function semanticGovernanceConfig(request: Request, env: Env): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_governance");
    if (request.method === "GET") return json(await listGovernanceConfig(env.QUERYMIND_APP));
    const body = await semanticBody(request, ["scopeKind", "domain", "assetId", "riskClass", "requiredApprovals", "allowProposerSelfApproval", "allowEmergencyPublication", "postReviewDueHours"]);
    const scopeKind = governanceScopeKind(body.scopeKind);
    const assetId = scopeKind === "ASSET" ? validateOpaqueId(body.assetId, "assetId") : undefined;
    const domain = optionalText(body.domain, "domain", SEMANTIC_LIMITS.domain) ?? "";
    if (scopeKind === "ASSET") {
      const asset = await loadGovernanceAsset(env.QUERYMIND_APP, assetId!);
      if (domain && domain !== asset.domain) throw new HttpError(400, "SEMANTIC_GOVERNANCE_INVALID", "asset policy domain must match the semantic asset domain.");
    }
    const riskClass = typeof body.riskClass === "string" && SEMANTIC_RISK_CLASSES.includes(body.riskClass as (typeof SEMANTIC_RISK_CLASSES)[number]) ? body.riskClass as (typeof SEMANTIC_RISK_CLASSES)[number] : (() => { throw new HttpError(400, "SEMANTIC_GOVERNANCE_INVALID", "riskClass is invalid."); })();
    const result = await createGovernancePolicy(env.QUERYMIND_APP, {
      actorId: user.id, scopeKind, domain: scopeKind === "ASSET" ? (await loadGovernanceAsset(env.QUERYMIND_APP, assetId!)).domain : domain, assetId,
      riskClass, requiredApprovals: integerField(body.requiredApprovals, "requiredApprovals", 1, 5),
      allowProposerSelfApproval: booleanField(body.allowProposerSelfApproval, "allowProposerSelfApproval"),
      allowEmergencyPublication: booleanField(body.allowEmergencyPublication, "allowEmergencyPublication"),
      postReviewDueHours: integerField(body.postReviewDueHours, "postReviewDueHours", 1, 720),
    });
    await auditSemantic(env, { actorId: user.id, eventType: "semantic.governance.policy.created", resourceType: "semantic_governance_policy", resourceId: result.policyId, metadata: { policyId: result.policyId, scopeKind, domain, riskClass, requiredApprovals: Number(body.requiredApprovals) } });
    return json(result, 201);
  });
}

export async function semanticGovernanceAuthorities(request: Request, env: Env): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_governance");
    const body = await semanticBody(request, ["scopeKind", "domain", "assetId", "userId", "raciRole", "canApprove", "canGovernRuntime"]);
    const scopeKind = governanceScopeKind(body.scopeKind);
    const assetId = scopeKind === "ASSET" ? validateOpaqueId(body.assetId, "assetId") : undefined;
    const domain = optionalText(body.domain, "domain", SEMANTIC_LIMITS.domain) ?? "";
    const raciRole = typeof body.raciRole === "string" && SEMANTIC_RACI_ROLES.includes(body.raciRole as (typeof SEMANTIC_RACI_ROLES)[number]) ? body.raciRole as (typeof SEMANTIC_RACI_ROLES)[number] : (() => { throw new HttpError(400, "SEMANTIC_GOVERNANCE_INVALID", "raciRole is invalid."); })();
    const scopedDomain = scopeKind === "ASSET" ? (await loadGovernanceAsset(env.QUERYMIND_APP, assetId!)).domain : domain;
    const result = await createSemanticAuthority(env.QUERYMIND_APP, {
      actorId: user.id, scopeKind, domain: scopedDomain, assetId, userId: validateOpaqueId(body.userId, "userId"), raciRole,
      canApprove: booleanField(body.canApprove, "canApprove"), canGovernRuntime: booleanField(body.canGovernRuntime, "canGovernRuntime"),
    });
    await auditSemantic(env, { actorId: user.id, eventType: "semantic.governance.authority.created", resourceType: "semantic_authority", resourceId: result.authorityId, metadata: { authorityId: result.authorityId, scopeKind, domain: scopedDomain } });
    return json(result, 201);
  });
}

export async function semanticApprovalReadiness(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireCapability(user, "view_semantics");
    const { asset, revision, readiness } = await approvalReadinessContext(env, user, assetId, revisionId, "APPROVE");
    return json({ assetId: asset.assetId, revisionId: revision.revisionId, revisionNumber: revision.revisionNumber, revisionStatus: revision.revisionStatus, proposerUserId: revision.createdBy, submittedBy: revision.submittedBy, ...readiness });
  });
}

export async function approveSemanticApi(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    const body = await semanticBody(request, ["idempotencyKey", "comment"]);
    const context = await approvalReadinessContext(env, user, assetId, revisionId, "APPROVE");
    requireReady(context.readiness);
    const result = await approveSemanticRevision(env.QUERYMIND_APP, { actorId: user.id, asset: context.asset, revision: context.revision, readiness: context.readiness, idempotencyKey: body.idempotencyKey, comment: body.comment });
    return json({ assetId: context.asset.assetId, revisionId: context.revision.revisionId, published: result.published, registryVersion: result.registryVersion, replayed: result.replayed, ...(result.published ? { status: "APPROVED" } : { status: "IN_REVIEW" }) });
  });
}

export async function emergencyPublishSemanticApi(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    const body = await semanticBody(request, ["idempotencyKey", "reason", "changeReference", "reviewDueAt"]);
    const context = await approvalReadinessContext(env, user, assetId, revisionId, "EMERGENCY_PUBLISH");
    requireReady(context.readiness);
    const result = await emergencyPublishSemanticRevision(env.QUERYMIND_APP, { actorId: user.id, asset: context.asset, revision: context.revision, readiness: context.readiness, idempotencyKey: body.idempotencyKey, reason: body.reason, changeReference: body.changeReference, reviewDueAt: body.reviewDueAt });
    return json({ assetId: context.asset.assetId, revisionId: context.revision.revisionId, publicationId: result.publicationId, status: "APPROVED", publicationMode: "EMERGENCY", registryVersion: result.registryVersion, replayed: result.replayed });
  });
}

async function runtimeGovernanceApi(request: Request, env: Env, assetId: string, revisionId: string, action: "SUSPEND" | "RESUME" | "POST_REVIEW_CONFIRMED" | "POST_REVIEW_REQUIRES_CORRECTION"): Promise<Response> {
  const user = await requireUser(request, env);
  requireBrowserSession(user);
  const body = await semanticBody(request, ["idempotencyKey", "reason"]);
  const readinessAction: SemanticGovernanceAction = action === "SUSPEND" ? "SUSPEND_RUNTIME" : action === "RESUME" ? "RESUME_RUNTIME" : "POST_REVIEW";
  const context = await approvalReadinessContext(env, user, assetId, revisionId, readinessAction);
  requireReady(context.readiness);
  const result = await governSemanticRuntime(env.QUERYMIND_APP, { actorId: user.id, action, asset: context.asset, revision: context.revision, readiness: context.readiness, idempotencyKey: body.idempotencyKey, reason: body.reason });
  const publication = await loadPublication(env.QUERYMIND_APP, context.revision.revisionId);
  return json({ assetId: context.asset.assetId, revisionId: context.revision.revisionId, registryVersion: result.registryVersion, replayed: result.replayed, runtimeEligibility: publication?.runtime_eligibility, postReviewStatus: publication?.post_review_status });
}

export function suspendSemanticRuntimeApi(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> { return governed(() => runtimeGovernanceApi(request, env, assetId, revisionId, "SUSPEND")); }
export function resumeSemanticRuntimeApi(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> { return governed(() => runtimeGovernanceApi(request, env, assetId, revisionId, "RESUME")); }
export function postReviewSemanticApi(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    const body = await semanticBody(request, ["idempotencyKey", "reason", "resolution"]);
    const resolution = body.resolution === "CONFIRMED" ? "POST_REVIEW_CONFIRMED" : body.resolution === "REQUIRES_CORRECTION" ? "POST_REVIEW_REQUIRES_CORRECTION" : null;
    if (!resolution) throw new HttpError(400, "SEMANTIC_GOVERNANCE_INVALID", "resolution must be CONFIRMED or REQUIRES_CORRECTION.");
    const context = await approvalReadinessContext(env, user, assetId, revisionId, "POST_REVIEW");
    requireReady(context.readiness);
    const result = await governSemanticRuntime(env.QUERYMIND_APP, { actorId: user.id, action: resolution, asset: context.asset, revision: context.revision, readiness: context.readiness, idempotencyKey: body.idempotencyKey, reason: body.reason });
    const publication = await loadPublication(env.QUERYMIND_APP, context.revision.revisionId);
    return json({ assetId: context.asset.assetId, revisionId: context.revision.revisionId, registryVersion: result.registryVersion, replayed: result.replayed, runtimeEligibility: publication?.runtime_eligibility, postReviewStatus: publication?.post_review_status });
  });
}

export async function semanticApprovalHistory(request: Request, env: Env, assetId: string, revisionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireCapability(user, "view_semantics");
    const asset = await loadGovernanceAsset(env.QUERYMIND_APP, assetId);
    const revision = await loadGovernanceRevision(env.QUERYMIND_APP, asset.assetId, revisionId);
    const [decisions, publication, runtimeEvents] = await Promise.all([
      env.QUERYMIND_APP.prepare("SELECT decision_id, actor_user_id, decision, risk_class, approval_slot, created_at FROM semantic_approval_decisions WHERE revision_id = ? ORDER BY created_at, decision_id").bind(revision.revisionId).all<Record<string, unknown>>(),
      env.QUERYMIND_APP.prepare("SELECT publication_id, publication_mode, published_at, registry_version_before, registry_version_after, review_due_at, post_review_status, runtime_eligibility FROM semantic_publications WHERE revision_id = ?").bind(revision.revisionId).first<Record<string, unknown>>(),
      env.QUERYMIND_APP.prepare("SELECT action, created_at FROM semantic_runtime_events WHERE publication_id = (SELECT publication_id FROM semantic_publications WHERE revision_id = ?) ORDER BY created_at").bind(revision.revisionId).all<Record<string, unknown>>(),
    ]);
    return json({ assetId: asset.assetId, revisionId: revision.revisionId, decisions: decisions.results ?? [], publication: publication ?? null, runtimeEvents: runtimeEvents.results ?? [] });
  });
}
