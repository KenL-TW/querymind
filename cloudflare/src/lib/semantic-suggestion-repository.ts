import { semanticAuditStatement } from "./audit";
import { HttpError } from "./http";
import type { AuthorizedSchemaCatalog } from "./schema-catalog";
import { SemanticRepositoryError } from "./semantic-repository";
import type { SemanticAssetType, SemanticContract } from "./semantic-types";
import { SEMANTIC_ASSET_TYPES } from "./semantic-types";
import { validateContract, validateOpaqueId } from "./semantic-validation";
import type { GeneratedSuggestion } from "./semantic-intelligence";
import type { SemanticSuggestionV1, SemanticSuggestionStatus, StoredSemanticSuggestion, SuggestionConfidence } from "./semantic-suggestion-types";
import { SEMANTIC_SUGGESTION_STATUSES, SUGGESTION_CONFIDENCE } from "./semantic-suggestion-types";

interface SuggestionRow {
  suggestion_id: string;
  run_id: string;
  suggestion_type: SemanticAssetType;
  status: SemanticSuggestionStatus;
  canonical_name: string;
  display_name: string;
  confidence: SuggestionConfidence;
  suggestion_json: string;
  schema_snapshot_id: string;
  created_at: string;
  accepted_asset_id: string | null;
  accepted_revision_id: string | null;
  accepted_at: string | null;
  dismissed_at: string | null;
  requested_by_user_id: string;
  prompt_fingerprint: string;
  model_config_fingerprint: string;
}

export interface SuggestionRunInput {
  runId: string;
  requestedBy: string;
  schemaSnapshotId: string;
  requestScope: Record<string, unknown>;
  catalogFingerprint: string;
  promptVersion: string;
  promptFingerprint: string;
  provider: string;
  model: string;
  modelConfigFingerprint: string;
}

function parseSuggestion(row: SuggestionRow, isStale: boolean): StoredSemanticSuggestion {
  let suggestion: SemanticSuggestionV1;
  try { suggestion = JSON.parse(row.suggestion_json) as SemanticSuggestionV1; } catch { throw new SemanticRepositoryError("SEMANTIC_SUGGESTION_DATA_INVALID", "Stored semantic suggestion data is invalid."); }
  if (suggestion.version !== "p2d.v1" || suggestion.target !== "NEW_ASSET" || suggestion.semanticType !== row.suggestion_type) throw new SemanticRepositoryError("SEMANTIC_SUGGESTION_DATA_INVALID", "Stored semantic suggestion data is invalid.");
  return { suggestionId: row.suggestion_id, runId: row.run_id, suggestionType: row.suggestion_type, status: row.status, canonicalName: row.canonical_name, displayName: row.display_name, confidence: row.confidence, suggestion, schemaSnapshotId: row.schema_snapshot_id, createdAt: row.created_at, isStale, acceptedAssetId: row.accepted_asset_id, acceptedRevisionId: row.accepted_revision_id, acceptedAt: row.accepted_at, dismissedAt: row.dismissed_at };
}

function rowSelect(where: string): string {
  return `SELECT s.suggestion_id, s.run_id, s.suggestion_type, s.status, s.canonical_name, s.display_name, s.confidence, s.suggestion_json, r.schema_snapshot_id, s.created_at, s.accepted_asset_id, s.accepted_revision_id, s.accepted_at, s.dismissed_at, r.requested_by_user_id, r.prompt_fingerprint, r.model_config_fingerprint FROM semantic_suggestions s JOIN semantic_suggestion_runs r ON r.run_id = s.run_id WHERE ${where}`;
}

function sourceIsAuthorized(contract: SemanticContract, type: SemanticAssetType, catalog: AuthorizedSchemaCatalog): boolean {
  const tableNames = new Set(catalog.tables.map((table) => table.name.toLowerCase()));
  const columns = new Set(catalog.tables.flatMap((table) => table.columns.map((column) => `${table.name.toLowerCase()}\u0000${column.name.toLowerCase()}`)));
  try {
    const result = validateContract(type, contract);
    return result.normalizedSources.every((source) => !source.tableName || (!source.columnName
      ? tableNames.has(source.tableName.toLowerCase())
      : columns.has(`${source.tableName.toLowerCase()}\u0000${source.columnName.toLowerCase()}`)));
  } catch { return false; }
}

export function suggestionIsAuthorized(suggestion: StoredSemanticSuggestion, catalog: AuthorizedSchemaCatalog): boolean {
  return sourceIsAuthorized(suggestion.suggestion.contract, suggestion.suggestionType, catalog)
    && suggestion.suggestion.evidence.tables.every((table) => catalog.tables.some((item) => item.name.toLowerCase() === table.toLowerCase()))
    && suggestion.suggestion.evidence.columns.every((reference) => {
      const [table, column] = reference.split(".");
      return catalog.tables.some((item) => item.name.toLowerCase() === table?.toLowerCase() && item.columns.some((field) => field.name.toLowerCase() === column?.toLowerCase()));
    });
}

export async function createSuggestionRun(database: D1Database, input: SuggestionRunInput): Promise<void> {
  await database.prepare(
    "INSERT INTO semantic_suggestion_runs (run_id, requested_by_user_id, schema_snapshot_id, request_scope_json, authorized_catalog_fingerprint, prompt_version, prompt_fingerprint, provider, model, model_config_fingerprint, status, attempt_count, suggestion_count, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'RUNNING', 0, 0, ?)",
  ).bind(input.runId, input.requestedBy, input.schemaSnapshotId, JSON.stringify(input.requestScope), input.catalogFingerprint, input.promptVersion, input.promptFingerprint, input.provider, input.model, input.modelConfigFingerprint, new Date().toISOString()).run();
}

export async function persistSuggestionRunSuccess(database: D1Database, input: { runId: string; actorId: string; attempts: number; suggestions: GeneratedSuggestion[]; schemaSnapshotId: string; promptFingerprint: string; modelConfigFingerprint: string }): Promise<StoredSemanticSuggestion[]> {
  const runId = validateOpaqueId(input.runId, "runId");
  const now = new Date().toISOString();
  const rows = input.suggestions.map((suggestion) => ({ suggestionId: crypto.randomUUID(), ...suggestion }));
  const statements: D1PreparedStatement[] = [
    ...rows.map((row) => database.prepare("INSERT INTO semantic_suggestions (suggestion_id, run_id, suggestion_type, status, canonical_name, display_name, confidence, suggestion_json, rationale_json, evidence_json, suggestion_fingerprint, created_at) VALUES (?, ?, ?, 'OPEN', ?, ?, ?, ?, ?, ?, ?, ?)").bind(row.suggestionId, runId, row.suggestion.semanticType, row.suggestion.canonicalName, row.suggestion.displayName, row.suggestion.confidence, row.suggestionJson, row.rationaleJson, row.evidenceJson, row.fingerprint, now)),
    database.prepare("UPDATE semantic_suggestion_runs SET status = 'SUCCEEDED', attempt_count = ?, suggestion_count = ?, completed_at = ?, error_code = NULL WHERE run_id = ? AND status = 'RUNNING'").bind(input.attempts, rows.length, now, runId),
    semanticAuditStatement(database, { actorId: input.actorId, eventType: "semantic.suggestion.generated", resourceType: "semantic_suggestion_run", resourceId: runId, metadata: { runId, schemaSnapshotId: input.schemaSnapshotId, promptFingerprint: input.promptFingerprint, modelConfigFingerprint: input.modelConfigFingerprint } }),
  ];
  const result = await database.batch(statements);
  const runIndex = rows.length;
  if ((result[runIndex]?.meta.changes ?? 0) !== 1 || (result.at(-1)?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_SUGGESTION_RUN_CONFLICT", "Suggestion run could not be completed.");
  return rows.map((row) => ({ suggestionId: row.suggestionId, runId, suggestionType: row.suggestion.semanticType, status: "OPEN", canonicalName: row.suggestion.canonicalName, displayName: row.suggestion.displayName, confidence: row.suggestion.confidence, suggestion: row.suggestion, schemaSnapshotId: input.schemaSnapshotId, createdAt: now, isStale: false, acceptedAssetId: null, acceptedRevisionId: null, acceptedAt: null, dismissedAt: null }));
}

export async function failSuggestionRun(database: D1Database, input: { runId: string; actorId: string; attempts: number; errorCode: string; schemaSnapshotId: string; promptFingerprint: string; modelConfigFingerprint: string }): Promise<void> {
  const runId = validateOpaqueId(input.runId, "runId");
  const now = new Date().toISOString();
  const results = await database.batch([
    database.prepare("UPDATE semantic_suggestion_runs SET status = 'FAILED', attempt_count = ?, error_code = ?, completed_at = ? WHERE run_id = ? AND status = 'RUNNING'").bind(Math.min(Math.max(input.attempts, 0), 2), input.errorCode.slice(0, 80), now, runId),
    semanticAuditStatement(database, { actorId: input.actorId, eventType: "semantic.suggestion.generation_failed", resourceType: "semantic_suggestion_run", resourceId: runId, metadata: { runId, schemaSnapshotId: input.schemaSnapshotId, promptFingerprint: input.promptFingerprint, modelConfigFingerprint: input.modelConfigFingerprint } }),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_SUGGESTION_RUN_CONFLICT", "Suggestion failure could not be recorded.");
}

export async function getStoredSuggestion(database: D1Database, suggestionIdValue: string, currentSchemaSnapshotId: string): Promise<{ suggestion: StoredSemanticSuggestion; requestedBy: string; promptFingerprint: string; modelConfigFingerprint: string }> {
  const suggestionId = validateOpaqueId(suggestionIdValue, "suggestionId");
  const row = await database.prepare(rowSelect("s.suggestion_id = ?")).bind(suggestionId).first<SuggestionRow>();
  if (!row) throw new SemanticRepositoryError("SEMANTIC_SUGGESTION_NOT_FOUND", "Semantic suggestion was not found.");
  return { suggestion: parseSuggestion(row, row.schema_snapshot_id !== currentSchemaSnapshotId), requestedBy: row.requested_by_user_id, promptFingerprint: row.prompt_fingerprint, modelConfigFingerprint: row.model_config_fingerprint };
}

export async function listStoredSuggestions(database: D1Database, input: { requestedBy: string; currentSchemaSnapshotId: string; status?: SemanticSuggestionStatus; type?: SemanticAssetType; runId?: string; stale?: boolean; page: number; limit: number }): Promise<{ items: Array<{ suggestion: StoredSemanticSuggestion; requestedBy: string }>; total: number; hasNext: boolean }> {
  const conditions = ["r.requested_by_user_id = ?"];
  const values: unknown[] = [input.requestedBy];
  if (input.status) { conditions.push("s.status = ?"); values.push(input.status); }
  if (input.type) { conditions.push("s.suggestion_type = ?"); values.push(input.type); }
  if (input.runId) { conditions.push("s.run_id = ?"); values.push(validateOpaqueId(input.runId, "runId")); }
  if (input.stale === true) conditions.push("r.schema_snapshot_id <> ?");
  if (input.stale === false) conditions.push("r.schema_snapshot_id = ?");
  if (input.stale !== undefined) values.push(input.currentSchemaSnapshotId);
  const where = conditions.join(" AND ");
  const count = await database.prepare(`SELECT COUNT(*) AS total FROM semantic_suggestions s JOIN semantic_suggestion_runs r ON r.run_id = s.run_id WHERE ${where}`).bind(...values).first<{ total: number }>();
  const offset = (input.page - 1) * input.limit;
  const rows = (await database.prepare(`${rowSelect(where)} ORDER BY s.created_at DESC, s.suggestion_id ASC LIMIT ? OFFSET ?`).bind(...values, input.limit, offset).all<SuggestionRow>()).results ?? [];
  return { items: rows.map((row) => ({ suggestion: parseSuggestion(row, row.schema_snapshot_id !== input.currentSchemaSnapshotId), requestedBy: row.requested_by_user_id })), total: count?.total ?? 0, hasNext: offset + rows.length < (count?.total ?? 0) };
}

export async function dismissStoredSuggestion(database: D1Database, input: { suggestionId: string; actorId: string; reason?: string; schemaSnapshotId: string; promptFingerprint: string; modelConfigFingerprint: string; suggestionType: SemanticAssetType }): Promise<void> {
  const suggestionId = validateOpaqueId(input.suggestionId, "suggestionId");
  const actorId = validateOpaqueId(input.actorId, "actorId");
  const now = new Date().toISOString();
  const reason = input.reason?.trim() ?? "";
  if (reason.length > 1000 || /[\u0000-\u001f\u007f]/u.test(reason)) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "dismissalReason is invalid.");
  const dismissedGuard = "SELECT 1 FROM semantic_suggestions WHERE suggestion_id = ? AND status = 'DISMISSED' AND dismissed_by_user_id = ? AND dismissed_at = ?";
  const results = await database.batch([
    database.prepare("UPDATE semantic_suggestions SET status = 'DISMISSED', dismissed_by_user_id = ?, dismissed_at = ?, dismissal_reason = ? WHERE suggestion_id = ? AND status = 'OPEN'").bind(actorId, now, reason || null, suggestionId),
    semanticAuditStatement(database, { actorId, eventType: "semantic.suggestion.dismissed", resourceType: "semantic_suggestion", resourceId: suggestionId, metadata: { suggestionId, suggestionType: input.suggestionType, schemaSnapshotId: input.schemaSnapshotId, promptFingerprint: input.promptFingerprint, modelConfigFingerprint: input.modelConfigFingerprint } }, { existsSql: dismissedGuard, values: [suggestionId, actorId, now] }),
  ]);
  if ((results[0]?.meta.changes ?? 0) !== 1 || (results[1]?.meta.changes ?? 0) !== 1) throw new SemanticRepositoryError("SEMANTIC_SUGGESTION_CONFLICT", "Only an OPEN suggestion can be dismissed.");
}

export function suggestionStatus(value: string | null): SemanticSuggestionStatus | undefined {
  if (!value) return undefined;
  if (!SEMANTIC_SUGGESTION_STATUSES.includes(value as SemanticSuggestionStatus)) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "suggestion status is invalid.");
  return value as SemanticSuggestionStatus;
}

export function suggestionType(value: string | null): SemanticAssetType | undefined {
  if (!value) return undefined;
  if (!SEMANTIC_ASSET_TYPES.includes(value as SemanticAssetType)) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "suggestion type is invalid.");
  return value as SemanticAssetType;
}

export function ensureSuggestionConfidence(value: string): SuggestionConfidence {
  if (!SUGGESTION_CONFIDENCE.includes(value as SuggestionConfidence)) throw new SemanticRepositoryError("SEMANTIC_SUGGESTION_DATA_INVALID", "Stored suggestion confidence is invalid.");
  return value as SuggestionConfidence;
}
