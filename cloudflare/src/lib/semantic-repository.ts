import { SemanticValidationError, SEMANTIC_LIMITS, validateAliases, validateAssetName, validateBoundedText, validateContract, validateOpaqueId, validateReviewComment, type NormalizedAlias } from "./semantic-validation";
import { semanticAuditStatement } from "./audit";
import type {
  SemanticAssetRecord,
  SemanticAssetStatus,
  SemanticAssetType,
  SemanticContract,
  SemanticCreateInput,
  SemanticRevisionCreateInput,
  SemanticRevisionRecord,
  SemanticRevisionStatus,
  SemanticRevisionUpdateInput,
  SemanticReviewAction,
} from "./semantic-types";

export class SemanticRepositoryError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "SemanticRepositoryError";
    this.code = code;
  }
}

interface AssetRow {
  asset_id: string;
  asset_type: SemanticAssetType;
  asset_status: SemanticAssetStatus;
  current_approved_revision_id: string | null;
}

interface AssetTypeRow extends AssetRow {
  canonical_name: string;
  display_name: string;
}

interface RevisionRow {
  revision_id: string;
  asset_id: string;
  asset_type: SemanticAssetType;
  revision_number: number;
  revision_status: SemanticRevisionStatus;
  payload_json: string;
  schema_snapshot_id: string;
}

interface LatestRevisionRow {
  asset_type: SemanticAssetType;
  asset_status: SemanticAssetStatus;
  canonical_name: string;
  display_name: string;
  max_revision: number;
}

interface RegistryStateRow {
  registry_version: number;
}

interface PreparedAssetCreation {
  assetId: string;
  revisionId: string;
  assetType: SemanticAssetType;
  canonical: string;
  display: string;
  domain: string;
  description: string;
  owner: string;
  creator: string;
  schemaSnapshotId: string;
  changeReason: string;
  contractResult: ReturnType<typeof validateContract>;
  aliases: NormalizedAlias[];
  createdAt: string;
  sources: Array<Record<string, unknown>>;
}

function now(): string {
  return new Date().toISOString();
}

function id(value: string | undefined, field: string): string {
  return value === undefined ? crypto.randomUUID() : validateOpaqueId(value, field);
}

function assertContractIdentity(contract: SemanticContract, canonical: string, display: string): void {
  if (contract.canonicalName !== canonical || contract.displayName !== display) throw new SemanticValidationError("contract", "canonicalName and displayName must match the asset identity");
}

function validateSnapshot(value: string, field: string): string {
  const snapshot = validateOpaqueId(value, field);
  if (snapshot === "uninitialized") throw new SemanticRepositoryError("SCHEMA_SNAPSHOT_UNAVAILABLE", "Schema catalog snapshot identity is unavailable.");
  return snapshot;
}

function normalizedSources(revisionId: string, result: ReturnType<typeof validateContract>): Array<Record<string, unknown>> {
  return result.normalizedSources.map((source) => ({
    sourceId: crypto.randomUUID(),
    revisionId,
    sourceKind: source.sourceKind,
    tableName: source.tableName,
    columnName: source.columnName,
    referencedAssetId: source.referencedAssetId,
    referencedRevisionId: source.referencedRevisionId,
    role: source.role,
    ordinalPosition: source.ordinalPosition,
  }));
}

function sourceStatements(database: D1Database, rows: Array<Record<string, unknown>>, createdAt: string, mutableOnly = false): D1PreparedStatement[] {
  return rows.map((row) => database.prepare(
    mutableOnly
      ? "INSERT INTO semantic_sources (source_id, revision_id, source_kind, table_name, column_name, referenced_asset_id, referenced_revision_id, role, ordinal_position, created_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'DRAFT')"
      : "INSERT INTO semantic_sources (source_id, revision_id, source_kind, table_name, column_name, referenced_asset_id, referenced_revision_id, role, ordinal_position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(row.sourceId, row.revisionId, row.sourceKind, row.tableName, row.columnName, row.referencedAssetId, row.referencedRevisionId, row.role, row.ordinalPosition, createdAt, ...(mutableOnly ? [row.revisionId] : [])));
}

function aliasStatements(database: D1Database, revisionId: string, aliases: NormalizedAlias[], createdAt: string, mutableOnly = false): D1PreparedStatement[] {
  return aliases.map((alias) => database.prepare(
    mutableOnly
      ? "INSERT INTO semantic_aliases (alias_id, revision_id, alias, normalized_alias, locale, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status IN ('DRAFT', 'IN_REVIEW'))"
      : "INSERT INTO semantic_aliases (alias_id, revision_id, alias, normalized_alias, locale, created_at) VALUES (?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), revisionId, alias.alias, alias.normalizedAlias, alias.locale, createdAt, ...(mutableOnly ? [revisionId] : [])));
}

function relationshipKeyStatements(database: D1Database, revisionId: string, contract: SemanticContract, createdAt: string): D1PreparedStatement[] {
  if (!("joinKeys" in contract)) return [];
  return contract.joinKeys.map((key, ordinalPosition) => database.prepare(
    "INSERT INTO semantic_relationship_keys (revision_id, ordinal_position, left_table, left_column, right_table, right_column, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'DRAFT')",
  ).bind(revisionId, ordinalPosition, key.leftTable, key.leftColumn, key.rightTable, key.rightColumn, createdAt, revisionId));
}

function reviewComment(value: unknown): string {
  try {
    return validateReviewComment(value);
  } catch (error) {
    if (error instanceof SemanticValidationError) throw error;
    throw new SemanticRepositoryError("SEMANTIC_REVIEW_INVALID", "Review comment is invalid.");
  }
}

export async function assertPinnedDependencies(database: D1Database, dependencies: Array<{ referencedAssetId: string; referencedRevisionId: string }>): Promise<void> {
  await Promise.all(dependencies.map(async (dependency) => {
    const row = await database.prepare(
      "SELECT revision_id, asset_id, revision_status FROM semantic_revisions WHERE revision_id = ? AND asset_id = ?",
    ).bind(dependency.referencedRevisionId, dependency.referencedAssetId).first<{ revision_id: string; asset_id: string; revision_status: SemanticRevisionStatus }>();
    if (!row || row.revision_id !== dependency.referencedRevisionId || row.asset_id !== dependency.referencedAssetId || row.revision_status !== "APPROVED") {
      throw new SemanticRepositoryError("SEMANTIC_DEPENDENCY_NOT_APPROVED", "A semantic dependency must pin an existing approved revision.");
    }
  }));
}

function contractAliases(value: unknown): NormalizedAlias[] {
  return validateAliases(value);
}

export async function getSemanticRegistryVersion(database: D1Database): Promise<number> {
  const row = await database.prepare("SELECT registry_version FROM semantic_registry_state WHERE state_key = 'global'").first<RegistryStateRow>();
  if (!row || !Number.isInteger(row.registry_version) || row.registry_version < 0) throw new SemanticRepositoryError("SEMANTIC_REGISTRY_UNAVAILABLE", "Semantic registry state is unavailable.");
  return row.registry_version;
}

export async function getSchemaSnapshotId(database: D1Database): Promise<string> {
  const row = await database.prepare("SELECT schema_snapshot_id FROM schema_catalog_state WHERE id = 1").first<{ schema_snapshot_id: string | null }>();
  if (!row?.schema_snapshot_id || row.schema_snapshot_id === "uninitialized") throw new SemanticRepositoryError("SCHEMA_SNAPSHOT_UNAVAILABLE", "Schema catalog snapshot identity is unavailable.");
  return validateSnapshot(row.schema_snapshot_id, "schema_snapshot_id");
}

/**
 * Validate only against the app-D1 catalog. This intentionally never reads
 * QUERYMIND_DATA rows and is a design-time provenance check, not approval.
 */
export async function assertSemanticCatalogReferences(
  database: D1Database,
  result: ReturnType<typeof validateContract>,
): Promise<void> {
  const tables = new Set<string>();
  const columns = new Set<string>();
  for (const source of result.normalizedSources) {
    if (source.sourceKind === "TABLE" && source.tableName) tables.add(source.tableName);
    if (source.sourceKind === "COLUMN" && source.tableName && source.columnName) columns.add(`${source.tableName}\u0000${source.columnName}`);
  }
  if (tables.size > 0) {
    const names = [...tables];
    const rows = (await database.prepare(`SELECT table_name FROM schema_catalog_tables WHERE table_name IN (${names.map(() => "?").join(",")})`).bind(...names).all<{ table_name: string }>()).results ?? [];
    const found = new Set(rows.map((row) => row.table_name.toLowerCase()));
    if (names.some((name) => !found.has(name.toLowerCase()))) throw new SemanticRepositoryError("SEMANTIC_CATALOG_REFERENCE_INVALID", "A semantic source table is not present in the current schema catalog.");
  }
  if (columns.size > 0) {
    const pairs = [...columns].map((key) => key.split("\u0000"));
    const predicate = pairs.map(() => "(table_name = ? AND column_name = ?)").join(" OR ");
    const values = pairs.flat();
    const rows = (await database.prepare(`SELECT table_name, column_name FROM schema_catalog_columns WHERE ${predicate}`).bind(...values).all<{ table_name: string; column_name: string }>()).results ?? [];
    const found = new Set(rows.map((row) => `${row.table_name.toLowerCase()}\u0000${row.column_name.toLowerCase()}`));
    if (pairs.some(([table, column]) => !found.has(`${table.toLowerCase()}\u0000${column.toLowerCase()}`))) throw new SemanticRepositoryError("SEMANTIC_CATALOG_REFERENCE_INVALID", "A semantic source column is not present in the current schema catalog.");
  }
}

export async function createSemanticAsset(database: D1Database, input: SemanticCreateInput): Promise<{ assetId: string; revisionId: string; revisionNumber: 1 }> {
  const prepared = await prepareSemanticAssetCreation(database, input);
  await database.batch(assetCreationStatements(database, prepared));
  return { assetId: prepared.assetId, revisionId: prepared.revisionId, revisionNumber: 1 };
}

async function prepareSemanticAssetCreation(database: D1Database, input: SemanticCreateInput): Promise<PreparedAssetCreation> {
  const canonical = validateAssetName(input.canonicalName, "canonicalName");
  const display = validateBoundedText(input.displayName, "displayName", SEMANTIC_LIMITS.displayName, true);
  const domain = validateBoundedText(input.domain ?? "", "domain", SEMANTIC_LIMITS.domain);
  const description = validateBoundedText(input.description ?? "", "description", SEMANTIC_LIMITS.definition);
  const creator = validateOpaqueId(input.createdBy, "createdBy");
  const owner = validateOpaqueId(input.ownerUserId, "ownerUserId");
  const schemaSnapshotId = validateSnapshot(input.schemaSnapshotId, "schemaSnapshotId");
  const contractResult = validateContract(input.assetType, input.contract);
  assertContractIdentity(contractResult.contract, canonical, display);
  const aliases = contractAliases(input.aliases);
  await assertPinnedDependencies(database, contractResult.contract.semanticDependencies);

  const assetId = id(input.assetId, "assetId");
  const revisionId = id(input.revisionId, "revisionId");
  const createdAt = now();
  const sources = normalizedSources(revisionId, contractResult);
  return { assetId, revisionId, assetType: input.assetType, canonical, display, domain, description, owner, creator, schemaSnapshotId, changeReason: validateBoundedText(input.changeReason ?? "", "changeReason", 1000), contractResult, aliases, createdAt, sources };
}

function assetCreationStatements(database: D1Database, prepared: PreparedAssetCreation): D1PreparedStatement[] {
  return [
    database.prepare("INSERT INTO semantic_assets (asset_id, asset_type, canonical_name, display_name, domain, description, owner_user_id, asset_status, current_approved_revision_id, created_by, created_at, updated_at, deprecated_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, ?, ?, NULL)").bind(prepared.assetId, prepared.assetType, prepared.canonical, prepared.display, prepared.domain, prepared.description, prepared.owner, prepared.creator, prepared.createdAt, prepared.createdAt),
    database.prepare("INSERT INTO semantic_revisions (revision_id, asset_id, revision_number, revision_status, payload_json, schema_snapshot_id, change_reason, created_by, created_at, submitted_by, submitted_at, approved_by, approved_at) VALUES (?, ?, 1, 'DRAFT', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL)").bind(prepared.revisionId, prepared.assetId, prepared.contractResult.payloadJson, prepared.schemaSnapshotId, prepared.changeReason, prepared.creator, prepared.createdAt),
    ...sourceStatements(database, prepared.sources, prepared.createdAt),
    ...relationshipKeyStatements(database, prepared.revisionId, prepared.contractResult.contract, prepared.createdAt),
    ...aliasStatements(database, prepared.revisionId, prepared.aliases, prepared.createdAt),
  ];
}

/**
 * P2-D uses the exact asset/revision validation and normalized-source builder
 * above, but couples the OPEN -> ACCEPTED transition, Draft creation, and
 * bounded audit record in one D1 batch. No generated suggestion can bypass
 * the canonical semantic repository.
 */
export async function acceptSemanticSuggestionAsDraft(
  database: D1Database,
  input: SemanticCreateInput & { suggestionId: string; acceptedBy: string; expectedSuggestionSnapshotId: string; promptFingerprint: string; modelConfigFingerprint: string },
): Promise<{ assetId: string; revisionId: string; revisionNumber: 1 }> {
  const suggestionId = validateOpaqueId(input.suggestionId, "suggestionId");
  const acceptedBy = validateOpaqueId(input.acceptedBy, "acceptedBy");
  const expectedSnapshot = validateSnapshot(input.expectedSuggestionSnapshotId, "expectedSuggestionSnapshotId");
  // Check before allocating the Draft, then repeat this invariant inside every
  // guarded write below so a concurrent catalog refresh cannot create a Draft
  // from a stale suggestion.
  if (await getSchemaSnapshotId(database) !== expectedSnapshot) {
    throw new SemanticRepositoryError("SEMANTIC_SCHEMA_STALE", "The suggestion was generated against a stale schema snapshot.");
  }
  const prepared = await prepareSemanticAssetCreation(database, input);
  if (prepared.schemaSnapshotId !== expectedSnapshot) throw new SemanticRepositoryError("SEMANTIC_SCHEMA_STALE", "The suggestion was generated against a stale schema snapshot.");
  const acceptedAt = now();
  const openGuard = "SELECT 1 FROM semantic_suggestions s JOIN semantic_suggestion_runs r ON r.run_id = s.run_id WHERE s.suggestion_id = ? AND s.status = 'OPEN' AND r.schema_snapshot_id = ? AND EXISTS (SELECT 1 FROM schema_catalog_state WHERE id = 1 AND schema_snapshot_id = ?)";
  const acceptedGuard = "SELECT 1 FROM semantic_suggestions WHERE suggestion_id = ? AND status = 'ACCEPTED' AND accepted_asset_id = ? AND accepted_revision_id = ?";
  const openInsert = (sql: string, values: unknown[], projection = values.map(() => "?").join(", ")) => database.prepare(`${sql} SELECT ${projection} WHERE EXISTS (${openGuard})`).bind(...values, suggestionId, expectedSnapshot, expectedSnapshot);
  const statements: D1PreparedStatement[] = [
    openInsert("INSERT INTO semantic_assets (asset_id, asset_type, canonical_name, display_name, domain, description, owner_user_id, asset_status, current_approved_revision_id, created_by, created_at, updated_at, deprecated_at)", [prepared.assetId, prepared.assetType, prepared.canonical, prepared.display, prepared.domain, prepared.description, prepared.owner, prepared.creator, prepared.createdAt, prepared.createdAt], "?, ?, ?, ?, ?, ?, ?, 'ACTIVE', NULL, ?, ?, ?, NULL"),
    openInsert("INSERT INTO semantic_revisions (revision_id, asset_id, revision_number, revision_status, payload_json, schema_snapshot_id, change_reason, created_by, created_at, submitted_by, submitted_at, approved_by, approved_at)", [prepared.revisionId, prepared.assetId, prepared.contractResult.payloadJson, prepared.schemaSnapshotId, prepared.changeReason, prepared.creator, prepared.createdAt], "?, ?, 1, 'DRAFT', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL"),
    ...prepared.sources.map((source) => openInsert("INSERT INTO semantic_sources (source_id, revision_id, source_kind, table_name, column_name, referenced_asset_id, referenced_revision_id, role, ordinal_position, created_at)", [source.sourceId, source.revisionId, source.sourceKind, source.tableName, source.columnName, source.referencedAssetId, source.referencedRevisionId, source.role, source.ordinalPosition, prepared.createdAt])),
    ...("joinKeys" in prepared.contractResult.contract ? prepared.contractResult.contract.joinKeys.map((key, ordinalPosition) => openInsert("INSERT INTO semantic_relationship_keys (revision_id, ordinal_position, left_table, left_column, right_table, right_column, created_at)", [prepared.revisionId, ordinalPosition, key.leftTable, key.leftColumn, key.rightTable, key.rightColumn, prepared.createdAt])) : []),
    ...prepared.aliases.map((alias) => openInsert("INSERT INTO semantic_aliases (alias_id, revision_id, alias, normalized_alias, locale, created_at)", [crypto.randomUUID(), prepared.revisionId, alias.alias, alias.normalizedAlias, alias.locale, prepared.createdAt])),
    // The foreign-key links are written only after the Draft revision exists.
    database.prepare("UPDATE semantic_suggestions SET status = 'ACCEPTED', accepted_asset_id = ?, accepted_revision_id = ?, accepted_by_user_id = ?, accepted_at = ? WHERE suggestion_id = ? AND status = 'OPEN' AND EXISTS (SELECT 1 FROM semantic_suggestion_runs WHERE run_id = semantic_suggestions.run_id AND schema_snapshot_id = ?) AND EXISTS (SELECT 1 FROM schema_catalog_state WHERE id = 1 AND schema_snapshot_id = ?) AND EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND asset_id = ? AND revision_status = 'DRAFT')").bind(prepared.assetId, prepared.revisionId, acceptedBy, acceptedAt, suggestionId, expectedSnapshot, expectedSnapshot, prepared.revisionId, prepared.assetId),
    semanticAuditStatement(database, { actorId: acceptedBy, eventType: "semantic.suggestion.accepted_as_draft", resourceType: "semantic_suggestion", resourceId: suggestionId, metadata: { suggestionId, assetId: prepared.assetId, revisionId: prepared.revisionId, suggestionType: prepared.assetType, schemaSnapshotId: prepared.schemaSnapshotId, promptFingerprint: input.promptFingerprint, modelConfigFingerprint: input.modelConfigFingerprint } }, { existsSql: acceptedGuard, values: [suggestionId, prepared.assetId, prepared.revisionId] }),
  ];
  const results = await database.batch(statements);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1 || (results.at(-2)?.meta.changes ?? 0) !== 1 || (results.at(-1)?.meta.changes ?? 0) !== 1) {
    throw new SemanticRepositoryError("SEMANTIC_SUGGESTION_CONFLICT", "The suggestion is no longer open or could not become a Draft.");
  }
  return { assetId: prepared.assetId, revisionId: prepared.revisionId, revisionNumber: 1 };
}

export async function createSemanticRevision(database: D1Database, input: SemanticRevisionCreateInput): Promise<{ revisionId: string; revisionNumber: number }> {
  const assetId = validateOpaqueId(input.assetId, "assetId");
  const schemaSnapshotId = validateSnapshot(input.schemaSnapshotId, "schemaSnapshotId");
  const creator = validateOpaqueId(input.createdBy, "createdBy");
  const asset = await database.prepare("SELECT a.asset_id, a.asset_type, a.asset_status, a.canonical_name, a.display_name, COALESCE(MAX(r.revision_number), 0) AS max_revision FROM semantic_assets a LEFT JOIN semantic_revisions r ON r.asset_id = a.asset_id WHERE a.asset_id = ? GROUP BY a.asset_id, a.asset_type, a.asset_status, a.canonical_name, a.display_name").bind(assetId).first<LatestRevisionRow>();
  if (!asset) throw new SemanticRepositoryError("SEMANTIC_ASSET_NOT_FOUND", "Semantic asset was not found.");
  if (asset.asset_status !== "ACTIVE") throw new SemanticRepositoryError("SEMANTIC_ASSET_DEPRECATED", "A deprecated semantic asset cannot receive a new revision.");
  const contractResult = validateContract(asset.asset_type, input.contract);
  assertContractIdentity(contractResult.contract, asset.canonical_name, asset.display_name);
  const aliases = contractAliases(input.aliases);
  await assertPinnedDependencies(database, contractResult.contract.semanticDependencies);
  const revisionId = id(input.revisionId, "revisionId");
  const createdAt = now();
  const sources = normalizedSources(revisionId, contractResult);
  // Compute the next number inside the write statement. D1/SQLite serializes
  // the write, while UNIQUE(asset_id, revision_number) remains the final
  // deterministic conflict guard for concurrent callers.
  const insertedBatch = await database.batch([
    database.prepare("INSERT INTO semantic_revisions (revision_id, asset_id, revision_number, revision_status, payload_json, schema_snapshot_id, change_reason, created_by, created_at, submitted_by, submitted_at, approved_by, approved_at) SELECT ?, a.asset_id, COALESCE(MAX(r.revision_number), 0) + 1, 'DRAFT', ?, ?, ?, ?, ?, NULL, NULL, NULL, NULL FROM semantic_assets a LEFT JOIN semantic_revisions r ON r.asset_id = a.asset_id WHERE a.asset_id = ? AND a.asset_status = 'ACTIVE' GROUP BY a.asset_id").bind(revisionId, contractResult.payloadJson, schemaSnapshotId, validateBoundedText(input.changeReason ?? "", "changeReason", 1000), creator, createdAt, assetId),
    ...sourceStatements(database, sources, createdAt),
    ...relationshipKeyStatements(database, revisionId, contractResult.contract, createdAt),
    ...aliasStatements(database, revisionId, aliases, createdAt),
  ]);
  if ((insertedBatch[0]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_REVISION_CONFLICT", "The revision could not be created because its asset changed.");
  const inserted = await database.prepare("SELECT revision_number FROM semantic_revisions WHERE revision_id = ? AND asset_id = ?").bind(revisionId, assetId).first<{ revision_number: number }>();
  // The fallback only supports the P2-A repository fake; a real D1 write
  // always returns the inserted row. The batch change guard above remains the
  // authoritative concurrency check.
  return { revisionId, revisionNumber: inserted?.revision_number ?? (asset.max_revision + 1) };
}

export async function updateDraftRevision(database: D1Database, input: SemanticRevisionUpdateInput): Promise<void> {
  const revisionId = validateOpaqueId(input.revisionId, "revisionId");
  const current = await database.prepare("SELECT r.revision_id, r.asset_id, a.asset_type, r.revision_status, r.payload_json, r.schema_snapshot_id, a.canonical_name, a.display_name FROM semantic_revisions r JOIN semantic_assets a ON a.asset_id = r.asset_id WHERE r.revision_id = ?").bind(revisionId).first<RevisionRow & { canonical_name: string; display_name: string }>();
  if (!current) throw new SemanticRepositoryError("SEMANTIC_REVISION_NOT_FOUND", "Semantic revision was not found.");
  if (current.revision_status !== "DRAFT") throw new SemanticRepositoryError("SEMANTIC_REVISION_IMMUTABLE", "Only DRAFT revisions can be edited; request changes before editing a review.");
  const contractResult = input.contract ? validateContract(current.asset_type, input.contract) : null;
  if (contractResult) assertContractIdentity(contractResult.contract, current.canonical_name, current.display_name);
  if (contractResult) await assertPinnedDependencies(database, contractResult.contract.semanticDependencies);
  const schemaSnapshotId = input.schemaSnapshotId ? validateSnapshot(input.schemaSnapshotId, "schemaSnapshotId") : current.schema_snapshot_id;
  const changeReason = input.changeReason === undefined ? null : validateBoundedText(input.changeReason, "changeReason", 1000);
  const aliases = input.aliases === undefined ? null : contractAliases(input.aliases);
  const updatedAt = now();
  const statements: D1PreparedStatement[] = [
    database.prepare("UPDATE semantic_revisions SET payload_json = COALESCE(?, payload_json), schema_snapshot_id = ?, change_reason = COALESCE(?, change_reason) WHERE revision_id = ? AND revision_status = 'DRAFT'").bind(contractResult?.payloadJson ?? null, schemaSnapshotId, changeReason, revisionId),
  ];
  if (contractResult) {
    const sources = normalizedSources(revisionId, contractResult);
    statements.push(
      database.prepare("DELETE FROM semantic_sources WHERE revision_id = ? AND EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'DRAFT')").bind(revisionId, revisionId),
      database.prepare("DELETE FROM semantic_relationship_keys WHERE revision_id = ? AND EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'DRAFT')").bind(revisionId, revisionId),
      ...sourceStatements(database, sources, updatedAt, true),
      ...relationshipKeyStatements(database, revisionId, contractResult.contract, updatedAt),
    );
  }
  if (aliases) {
    statements.push(database.prepare("DELETE FROM semantic_aliases WHERE revision_id = ? AND EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'DRAFT')").bind(revisionId, revisionId), ...aliasStatements(database, revisionId, aliases, updatedAt, true));
  }
  const results = await database.batch(statements);
  if ((results[0]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_REVISION_CONFLICT", "The revision changed before it could be updated.");
}

export async function submitSemanticRevision(database: D1Database, revisionIdValue: string, submittedByValue: string): Promise<void> {
  const revisionId = validateOpaqueId(revisionIdValue, "revisionId");
  const submittedBy = validateOpaqueId(submittedByValue, "submittedBy");
  const submittedAt = now();
  const results = await database.batch([
    database.prepare("UPDATE semantic_revisions SET revision_status = 'IN_REVIEW', submitted_by = ?, submitted_at = ? WHERE revision_id = ? AND revision_status = 'DRAFT'").bind(submittedBy, submittedAt, revisionId),
    database.prepare("INSERT INTO semantic_reviews (review_id, revision_id, action, reviewer_user_id, comment, created_at) SELECT ?, ?, 'SUBMITTED', ?, '', ? WHERE EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'IN_REVIEW' AND submitted_at = ?)").bind(crypto.randomUUID(), revisionId, submittedBy, submittedAt, revisionId, submittedAt),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_REVIEW_CONFLICT", "Only a DRAFT revision can be submitted for review.");
}

/** IN_REVIEW -> DRAFT, with the immutable review event in the same batch. */
export async function requestSemanticChanges(database: D1Database, input: { revisionId: string; reviewerUserId: string; comment: string }): Promise<string> {
  const revisionId = validateOpaqueId(input.revisionId, "revisionId");
  const reviewerUserId = validateOpaqueId(input.reviewerUserId, "reviewerUserId");
  const comment = reviewComment(input.comment);
  const reviewId = crypto.randomUUID();
  const createdAt = now();
  const results = await database.batch([
    database.prepare("UPDATE semantic_revisions SET revision_status = 'DRAFT', submitted_by = NULL, submitted_at = NULL WHERE revision_id = ? AND revision_status = 'IN_REVIEW'").bind(revisionId),
    database.prepare("INSERT INTO semantic_reviews (review_id, revision_id, action, reviewer_user_id, comment, created_at) SELECT ?, ?, 'REQUEST_CHANGES', ?, ?, ? WHERE EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'DRAFT')").bind(reviewId, revisionId, reviewerUserId, comment, createdAt, revisionId),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_REVIEW_CONFLICT", "Only an IN_REVIEW revision can receive request changes.");
  return reviewId;
}

/** IN_REVIEW -> REJECTED, preserving the historical contract and review event. */
export async function rejectSemanticRevision(database: D1Database, input: { revisionId: string; reviewerUserId: string; comment: string }): Promise<string> {
  const revisionId = validateOpaqueId(input.revisionId, "revisionId");
  const reviewerUserId = validateOpaqueId(input.reviewerUserId, "reviewerUserId");
  const comment = reviewComment(input.comment);
  const reviewId = crypto.randomUUID();
  const createdAt = now();
  const results = await database.batch([
    database.prepare("UPDATE semantic_revisions SET revision_status = 'REJECTED' WHERE revision_id = ? AND revision_status = 'IN_REVIEW'").bind(revisionId),
    database.prepare("INSERT INTO semantic_reviews (review_id, revision_id, action, reviewer_user_id, comment, created_at) SELECT ?, ?, 'REJECTED', ?, ?, ? WHERE EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'REJECTED')").bind(reviewId, revisionId, reviewerUserId, comment, createdAt, revisionId),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_REVIEW_CONFLICT", "Only an IN_REVIEW revision can be rejected.");
  return reviewId;
}

/** Persist an immutable review event without changing semantic meaning. */
export async function recordSemanticReview(database: D1Database, input: { revisionId: string; action: SemanticReviewAction; reviewerUserId: string; comment?: string }): Promise<string> {
  const revisionId = validateOpaqueId(input.revisionId, "revisionId");
  const reviewerUserId = validateOpaqueId(input.reviewerUserId, "reviewerUserId");
  const action = input.action;
  if (!["SUBMITTED", "APPROVED", "REJECTED", "REQUEST_CHANGES", "DEPRECATED"].includes(action)) throw new SemanticRepositoryError("SEMANTIC_REVIEW_INVALID", "Unsupported semantic review action.");
  const comment = reviewComment(input.comment ?? "");
  const reviewId = crypto.randomUUID();
  const result = await database.prepare("INSERT INTO semantic_reviews (review_id, revision_id, action, reviewer_user_id, comment, created_at) SELECT ?, ?, ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ?)").bind(reviewId, revisionId, action, reviewerUserId, comment, now(), revisionId).run();
  if (result.meta.changes !== 1) throw new SemanticRepositoryError("SEMANTIC_REVISION_NOT_FOUND", "Semantic revision was not found.");
  return reviewId;
}

export async function activateApprovedRevision(database: D1Database, input: { assetId: string; revisionId: string; revisionNumber: number; approvedBy: string; expectedSchemaSnapshotId?: string }): Promise<{ registryVersion: number }> {
  const assetId = validateOpaqueId(input.assetId, "assetId");
  const revisionId = validateOpaqueId(input.revisionId, "revisionId");
  const approvedBy = validateOpaqueId(input.approvedBy, "approvedBy");
  if (!Number.isInteger(input.revisionNumber) || input.revisionNumber < 1) throw new SemanticRepositoryError("SEMANTIC_REVISION_INVALID", "revisionNumber must be a positive integer.");
  const revision = await database.prepare("SELECT r.revision_id, r.asset_id, a.asset_type, r.revision_number, r.revision_status, r.payload_json, r.schema_snapshot_id FROM semantic_revisions r JOIN semantic_assets a ON a.asset_id = r.asset_id WHERE r.revision_id = ? AND r.asset_id = ?").bind(revisionId, assetId).first<RevisionRow>();
  if (!revision) throw new SemanticRepositoryError("SEMANTIC_REVISION_NOT_FOUND", "Semantic revision was not found.");
  if (revision.revision_status === "APPROVED") throw new SemanticRepositoryError("SEMANTIC_REVISION_IMMUTABLE", "An approved revision cannot be approved again.");
  if (revision.revision_status !== "IN_REVIEW" || revision.revision_number !== input.revisionNumber) throw new SemanticRepositoryError("SEMANTIC_APPROVAL_CONFLICT", "Only the expected IN_REVIEW revision can be approved.");
  if (input.expectedSchemaSnapshotId && revision.schema_snapshot_id !== validateSnapshot(input.expectedSchemaSnapshotId, "expectedSchemaSnapshotId")) throw new SemanticRepositoryError("SEMANTIC_SCHEMA_STALE", "The revision was authored against a stale schema snapshot.");
  const contract = JSON.parse(revision.payload_json) as unknown;
  const contractResult = validateContract(revision.asset_type, contract);
  await assertPinnedDependencies(database, contractResult.contract.semanticDependencies);
  const approvedAt = now();
  const results = await database.batch([
    database.prepare("UPDATE semantic_revisions SET revision_status = 'APPROVED', approved_by = ?, approved_at = ? WHERE revision_id = ? AND asset_id = ? AND revision_number = ? AND revision_status = 'IN_REVIEW' AND EXISTS (SELECT 1 FROM semantic_assets WHERE asset_id = ? AND asset_status = 'ACTIVE' AND (current_approved_revision_id IS NULL OR current_approved_revision_id <> ?))").bind(approvedBy, approvedAt, revisionId, assetId, input.revisionNumber, assetId, revisionId),
    database.prepare("UPDATE semantic_assets SET current_approved_revision_id = ?, updated_at = ? WHERE asset_id = ? AND asset_status = 'ACTIVE' AND (current_approved_revision_id IS NULL OR current_approved_revision_id <> ?) AND EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND asset_id = ? AND revision_status = 'APPROVED' AND approved_at = ?)").bind(revisionId, approvedAt, assetId, revisionId, revisionId, assetId, approvedAt),
    database.prepare("UPDATE semantic_registry_state SET registry_version = registry_version + 1, updated_at = ? WHERE state_key = 'global' AND EXISTS (SELECT 1 FROM semantic_assets WHERE asset_id = ? AND asset_status = 'ACTIVE' AND current_approved_revision_id = ? AND updated_at = ?)").bind(approvedAt, assetId, revisionId, approvedAt),
    database.prepare("INSERT INTO semantic_reviews (review_id, revision_id, action, reviewer_user_id, comment, created_at) SELECT ?, ?, 'APPROVED', ?, '', ? WHERE EXISTS (SELECT 1 FROM semantic_revisions WHERE revision_id = ? AND revision_status = 'APPROVED' AND approved_at = ?) AND EXISTS (SELECT 1 FROM semantic_assets WHERE asset_id = ? AND current_approved_revision_id = ? AND updated_at = ?)").bind(crypto.randomUUID(), revisionId, approvedBy, approvedAt, revisionId, approvedAt, assetId, revisionId, approvedAt),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1 || (results[2]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_APPROVAL_CONFLICT", "Approval activation did not satisfy its atomic preconditions.");
  return { registryVersion: await getSemanticRegistryVersion(database) };
}

export async function deprecateSemanticAsset(database: D1Database, assetIdValue: string, actorIdValue: string): Promise<{ registryVersion: number }> {
  const assetId = validateOpaqueId(assetIdValue, "assetId");
  const actorId = validateOpaqueId(actorIdValue, "actorId");
  const deprecatedAt = now();
  const results = await database.batch([
    database.prepare("UPDATE semantic_assets SET asset_status = 'DEPRECATED', deprecated_at = ?, updated_at = ? WHERE asset_id = ? AND asset_status = 'ACTIVE'").bind(deprecatedAt, deprecatedAt, assetId),
    database.prepare("UPDATE semantic_registry_state SET registry_version = registry_version + 1, updated_at = ? WHERE state_key = 'global' AND EXISTS (SELECT 1 FROM semantic_assets WHERE asset_id = ? AND asset_status = 'DEPRECATED' AND updated_at = ?)").bind(deprecatedAt, assetId, deprecatedAt),
    database.prepare("INSERT INTO semantic_reviews (review_id, revision_id, action, reviewer_user_id, comment, created_at) SELECT ?, r.revision_id, 'DEPRECATED', ?, '', ? FROM semantic_revisions r WHERE r.asset_id = ? AND r.revision_status = 'APPROVED' AND EXISTS (SELECT 1 FROM semantic_assets WHERE asset_id = ? AND asset_status = 'DEPRECATED' AND updated_at = ?) ORDER BY r.revision_number DESC LIMIT 1").bind(crypto.randomUUID(), actorId, deprecatedAt, assetId, assetId, deprecatedAt),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_DEPRECATION_CONFLICT", "Asset deprecation did not satisfy its atomic preconditions.");
  return { registryVersion: await getSemanticRegistryVersion(database) };
}

export async function readSemanticRevision(database: D1Database, revisionIdValue: string): Promise<SemanticRevisionRecord | null> {
  const revisionId = validateOpaqueId(revisionIdValue, "revisionId");
  const row = await database.prepare("SELECT revision_id, asset_id, revision_number, revision_status, payload_json, schema_snapshot_id, change_reason, created_by, created_at, submitted_by, submitted_at, approved_by, approved_at FROM semantic_revisions WHERE revision_id = ?").bind(revisionId).first<{
    revision_id: string; asset_id: string; revision_number: number; revision_status: SemanticRevisionStatus; payload_json: string; schema_snapshot_id: string; change_reason: string; created_by: string; created_at: string; submitted_by: string | null; submitted_at: string | null; approved_by: string | null; approved_at: string | null;
  }>();
  if (!row) return null;
  return { revisionId: row.revision_id, assetId: row.asset_id, revisionNumber: row.revision_number, revisionStatus: row.revision_status, payloadJson: row.payload_json, schemaSnapshotId: row.schema_snapshot_id, changeReason: row.change_reason, createdBy: row.created_by, createdAt: row.created_at, submittedBy: row.submitted_by, submittedAt: row.submitted_at, approvedBy: row.approved_by, approvedAt: row.approved_at };
}

export function toSemanticAssetRecord(row: {
  asset_id: string; asset_type: SemanticAssetType; canonical_name: string; display_name: string; domain: string; description: string; owner_user_id: string; asset_status: SemanticAssetStatus; current_approved_revision_id: string | null; created_by: string; created_at: string; updated_at: string; deprecated_at: string | null;
}): SemanticAssetRecord {
  return { assetId: row.asset_id, assetType: row.asset_type, canonicalName: row.canonical_name, displayName: row.display_name, domain: row.domain, description: row.description, ownerUserId: row.owner_user_id, assetStatus: row.asset_status, currentApprovedRevisionId: row.current_approved_revision_id, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at, deprecatedAt: row.deprecated_at };
}
