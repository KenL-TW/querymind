import type { AuthorizedSchemaCatalog } from "./schema-catalog";
import type { EffectiveScope } from "./scope";
import { validateContract } from "./semantic-validation";
import type { MetricExpression, NormalizedSemanticSource, SemanticAssetType, SemanticContract } from "./semantic-types";

/** This version is part of the future cache key and telemetry contract. */
export const APPROVED_SEMANTIC_CONTEXT_CONTRACT_VERSION = "p2-f-v1";

export const SEMANTIC_CONTEXT_LIMITS = {
  candidateScan: 128,
  assets: 8,
  aliasesPerAsset: 8,
  dependenciesPerAsset: 8,
  relationshipExpansions: 4,
  serializedBytes: 12_000,
  definitionCharacters: 800,
} as const;

export type SemanticContextStatus = "READY" | "OMITTED" | "ASK" | "REFUSE";

export interface SemanticContextCandidate {
  assetId: string;
  revisionId: string;
  assetType: SemanticAssetType;
  label: string;
  domain: string;
}

export interface SemanticEvidenceSource {
  table: string;
  column?: string;
}

/**
 * A bounded, immutable projection of the exact object supplied to the model.
 * It is observational only: P2-G stores it after a successful governed run and
 * it is never read by authorization, planning, or the resolver.
 */
export interface SelectedSemanticProvenance extends SemanticContextCandidate {
  schemaSnapshotId: string;
  canonicalName: string;
  sources: SemanticEvidenceSource[];
  grain?: string;
  metricAstSummary?: string;
  relationshipRefs?: string[];
  definition?: string;
}

export interface ResolvedSemanticContext {
  status: SemanticContextStatus;
  code: string | null;
  registryVersion: number;
  schemaSnapshotId: string;
  modelContext: string;
  selected: SelectedSemanticProvenance[];
  candidates: SemanticContextCandidate[];
  candidateCount: number;
  excludedCount: number;
  fallbackToP1: boolean;
  serializedBytes: number;
  latencyMs: number;
}

interface CandidateRow {
  asset_id: string;
  asset_type: SemanticAssetType;
  canonical_name: string;
  display_name: string;
  domain: string;
  asset_status: "ACTIVE" | "DEPRECATED";
  current_approved_revision_id: string | null;
  revision_id: string;
  revision_status: "DRAFT" | "IN_REVIEW" | "APPROVED" | "REJECTED";
  payload_json: string;
  schema_snapshot_id: string;
  runtime_eligibility: "ELIGIBLE" | "SUSPENDED";
}

interface AliasRow { revision_id: string; alias: string; normalized_alias: string; }
interface SourceRow {
  revision_id: string;
  source_kind: "TABLE" | "COLUMN" | "SEMANTIC_DEPENDENCY";
  table_name: string | null;
  column_name: string | null;
  referenced_asset_id: string | null;
  referenced_revision_id: string | null;
  role: string;
  ordinal_position: number;
}

interface Candidate extends CandidateRow {
  contract: SemanticContract;
  aliases: AliasRow[];
  sources: SourceRow[];
}

function empty(registryVersion: number, schemaSnapshotId: string, startedAt: number, code: string | null = null, status: SemanticContextStatus = "OMITTED", candidates: SemanticContextCandidate[] = [], candidateCount = 0, excludedCount = 0): ResolvedSemanticContext {
  return { status, code, registryVersion, schemaSnapshotId, modelContext: "", selected: [], candidates, candidateCount, excludedCount, fallbackToP1: status === "OMITTED", serializedBytes: 0, latencyMs: Date.now() - startedAt };
}

function normalized(value: string): string {
  return value.toLocaleLowerCase("und").replace(/[_-]+/gu, " ").replace(/\s+/gu, " ").trim();
}

function sourceKey(source: Pick<NormalizedSemanticSource, "sourceKind" | "tableName" | "columnName" | "referencedAssetId" | "referencedRevisionId" | "role">): string {
  return [source.sourceKind, source.tableName ?? "", source.columnName ?? "", source.referencedAssetId ?? "", source.referencedRevisionId ?? "", source.role].join("\u0000");
}

function rowSourceKey(source: SourceRow): string {
  return [source.source_kind, source.table_name ?? "", source.column_name ?? "", source.referenced_asset_id ?? "", source.referenced_revision_id ?? "", source.role].join("\u0000");
}

function catalogAllows(catalog: AuthorizedSchemaCatalog, source: SourceRow): boolean {
  if (source.source_kind === "SEMANTIC_DEPENDENCY") return Boolean(source.referenced_asset_id && source.referenced_revision_id);
  const table = source.table_name?.toLocaleLowerCase("und");
  if (!table) return false;
  const catalogTable = catalog.tables.find((entry) => entry.name.toLocaleLowerCase("und") === table);
  if (!catalogTable) return false;
  return source.source_kind === "TABLE" || Boolean(source.column_name && catalogTable.columns.some((column) => column.name.toLocaleLowerCase("und") === source.column_name?.toLocaleLowerCase("und")));
}

function scopeAllows(scope: EffectiveScope, source: SourceRow): boolean {
  if (source.source_kind === "SEMANTIC_DEPENDENCY") return true;
  const table = source.table_name?.toLocaleLowerCase("und");
  const policy = table ? scope.datasource.tables[table] : undefined;
  if (!policy) return false;
  return source.source_kind === "TABLE" || Boolean(source.column_name && (policy.columns === "*" || policy.columns.includes(source.column_name.toLocaleLowerCase("und"))));
}

function candidateLabel(candidate: Candidate): string { return candidate.display_name || candidate.canonical_name; }

function candidateMatchesPrompt(candidate: Candidate, prompt: string): boolean {
  const question = normalized(prompt);
  if (!question) return false;
  const labels = [candidate.canonical_name, candidate.display_name, ...candidate.aliases.map((alias) => alias.normalized_alias)];
  return labels.some((label) => {
    const value = normalized(label);
    if (!value) return false;
    return question.includes(value) || value.split(" ").filter((token) => token.length >= 3).some((token) => question.includes(token));
  });
}

function requestedDomain(candidates: Candidate[], prompt: string): string | null {
  const question = normalized(prompt);
  const matching = [...new Set(candidates.map((candidate) => candidate.domain).filter((domain) => domain && question.includes(normalized(domain))))];
  return matching.length === 1 ? matching[0] : null;
}

function safeJson(value: unknown): string {
  return JSON.stringify(value).replace(/[&<>]/gu, (character) => character === "&" ? "\\u0026" : character === "<" ? "\\u003c" : "\\u003e");
}

function metricExpressionSummary(expression: MetricExpression, depth = 0): string {
  if (depth > 6) return "…";
  if (expression.kind === "COLUMN") return `${expression.source.table}.${expression.source.column}`;
  if (expression.kind === "LITERAL") return String(expression.value);
  if (expression.kind === "COUNT") return expression.mode === "ROWS" ? "COUNT(*)" : `COUNT(${expression.source.table}.${expression.source.column})`;
  if (expression.kind === "COUNT_DISTINCT") return `COUNT DISTINCT ${expression.source.table}.${expression.source.column}`;
  if (expression.kind === "SUM" || expression.kind === "AVG" || expression.kind === "MIN" || expression.kind === "MAX") return `${expression.kind}(${metricExpressionSummary(expression.argument, depth + 1)})`;
  if (expression.kind === "ADD" || expression.kind === "SUBTRACT" || expression.kind === "MULTIPLY" || expression.kind === "DIVIDE") {
    const operators: Record<typeof expression.kind, string> = { ADD: "+", SUBTRACT: "−", MULTIPLY: "×", DIVIDE: "÷" };
    return `(${metricExpressionSummary(expression.left, depth + 1)} ${operators[expression.kind]} ${metricExpressionSummary(expression.right, depth + 1)})`;
  }
  return "bounded expression";
}

function grainSummary(contract: Extract<SemanticContract, { nativeGrain?: unknown }>): string | undefined {
  const grain = contract.nativeGrain;
  if (!grain) return undefined;
  return grain.kind === "ENTITY" ? grain.key.slice(0, 120) : `${grain.key} (${grain.timeUnit})`.slice(0, 120);
}

function evidenceSelection(candidate: Candidate, schemaSnapshotId: string): SelectedSemanticProvenance {
  const physicalSources = candidate.sources
    .filter((source) => source.source_kind !== "SEMANTIC_DEPENDENCY" && Boolean(source.table_name))
    .slice(0, SEMANTIC_CONTEXT_LIMITS.dependenciesPerAsset)
    .map((source) => ({ table: source.table_name as string, ...(source.column_name ? { column: source.column_name } : {}) }));
  const base: SelectedSemanticProvenance = {
    assetId: candidate.asset_id,
    revisionId: candidate.revision_id,
    assetType: candidate.asset_type,
    label: candidateLabel(candidate).slice(0, 160),
    canonicalName: candidate.canonical_name.slice(0, 160),
    domain: candidate.domain.slice(0, 120),
    schemaSnapshotId,
    sources: physicalSources,
  };
  if (candidate.asset_type === "METRIC") {
    const contract = candidate.contract as Extract<SemanticContract, { expression: MetricExpression; nativeGrain: unknown }>;
    return { ...base, grain: grainSummary(contract), metricAstSummary: metricExpressionSummary(contract.expression).slice(0, 500) };
  }
  if (candidate.asset_type === "DIMENSION") {
    const contract = candidate.contract as Extract<SemanticContract, { nativeGrain?: unknown }>;
    return { ...base, grain: grainSummary(contract) };
  }
  if (candidate.asset_type === "RELATIONSHIP") {
    const contract = candidate.contract as Extract<SemanticContract, { joinKeys: Array<{ leftTable: string; leftColumn: string; rightTable: string; rightColumn: string }> }>;
    return { ...base, relationshipRefs: contract.joinKeys.slice(0, SEMANTIC_CONTEXT_LIMITS.relationshipExpansions).map((key) => `${key.leftTable}.${key.leftColumn} → ${key.rightTable}.${key.rightColumn}`.slice(0, 240)) };
  }
  return { ...base, definition: candidate.contract.definition.slice(0, 280) };
}

function projection(candidate: Candidate, schemaSnapshotId: string): Record<string, unknown> {
  const contract = candidate.contract;
  const base = {
    assetId: candidate.asset_id,
    revisionId: candidate.revision_id,
    type: candidate.asset_type,
    name: candidateLabel(candidate),
    canonicalName: candidate.canonical_name,
    domain: candidate.domain,
    definition: contract.definition.slice(0, SEMANTIC_CONTEXT_LIMITS.definitionCharacters),
    aliases: candidate.aliases.slice(0, SEMANTIC_CONTEXT_LIMITS.aliasesPerAsset).map((alias) => alias.alias),
    sources: candidate.sources.filter((source) => source.source_kind !== "SEMANTIC_DEPENDENCY").map((source) => source.source_kind === "TABLE" ? { table: source.table_name } : { table: source.table_name, column: source.column_name }),
    dependencies: candidate.sources.filter((source) => source.source_kind === "SEMANTIC_DEPENDENCY").slice(0, SEMANTIC_CONTEXT_LIMITS.dependenciesPerAsset).map((source) => ({ assetId: source.referenced_asset_id, revisionId: source.referenced_revision_id })),
    schemaSnapshotId,
  };
  if (candidate.asset_type === "METRIC") {
    const metric = contract as Extract<SemanticContract, { expression: unknown }>;
    return { ...base, metricAst: metric.expression, grain: metric.nativeGrain, unit: metric.unit, ...(metric.currency ? { currency: metric.currency } : {}) };
  }
  if (candidate.asset_type === "DIMENSION") {
    const dimension = contract as Extract<SemanticContract, { allowedOperations: unknown }>;
    return { ...base, source: dimension.source, dataType: dimension.dataType, allowedOperations: dimension.allowedOperations, ...(dimension.nativeGrain ? { grain: dimension.nativeGrain } : {}) };
  }
  if (candidate.asset_type === "RELATIONSHIP") {
    const relationship = contract as Extract<SemanticContract, { joinKeys: unknown }>;
    return { ...base, from: relationship.leftTable, to: relationship.rightTable, cardinality: relationship.cardinality, joinKeys: relationship.joinKeys };
  }
  const term = contract as Extract<SemanticContract, { source?: unknown }>;
  return { ...base, ...(term.source ? { source: term.source } : {}) };
}

async function registryVersion(database: D1Database): Promise<number> {
  const state = await database.prepare("SELECT registry_version FROM semantic_registry_state WHERE state_key = 'global'").first<{ registry_version: number }>();
  if (!state || !Number.isInteger(state.registry_version) || state.registry_version < 0) throw new Error("semantic registry state unavailable");
  return state.registry_version;
}

async function runtimeRows(database: D1Database, currentVersion: number): Promise<CandidateRow[]> {
  const result = await database.prepare(
    "SELECT a.asset_id, a.asset_type, a.canonical_name, a.display_name, a.domain, a.asset_status, a.current_approved_revision_id, r.revision_id, r.revision_status, r.payload_json, r.schema_snapshot_id, p.runtime_eligibility FROM semantic_assets a JOIN semantic_revisions r ON r.revision_id = a.current_approved_revision_id AND r.asset_id = a.asset_id JOIN semantic_publications p ON p.asset_id = a.asset_id AND p.revision_id = r.revision_id WHERE a.asset_status = 'ACTIVE' AND r.revision_status = 'APPROVED' AND p.registry_version_after <= ? ORDER BY a.asset_type, a.canonical_name, a.domain, r.revision_id LIMIT ?",
  ).bind(currentVersion, SEMANTIC_CONTEXT_LIMITS.candidateScan + 1).all<CandidateRow>();
  return result.results ?? [];
}

async function aliasesFor(database: D1Database, revisionIds: string[]): Promise<AliasRow[]> {
  if (revisionIds.length === 0) return [];
  const result = await database.prepare(`SELECT revision_id, alias, normalized_alias FROM semantic_aliases WHERE revision_id IN (${revisionIds.map(() => "?").join(",")}) ORDER BY normalized_alias, alias`).bind(...revisionIds).all<AliasRow>();
  return result.results ?? [];
}

async function sourcesFor(database: D1Database, revisionIds: string[]): Promise<SourceRow[]> {
  if (revisionIds.length === 0) return [];
  const result = await database.prepare(`SELECT revision_id, source_kind, table_name, column_name, referenced_asset_id, referenced_revision_id, role, ordinal_position FROM semantic_sources WHERE revision_id IN (${revisionIds.map(() => "?").join(",")}) ORDER BY revision_id, ordinal_position`).bind(...revisionIds).all<SourceRow>();
  return result.results ?? [];
}

/**
 * Resolves only the current, human-published semantic definitions that are
 * independently allowed by the caller's EffectiveScope and catalog. This is
 * deliberately read-only and has no cache: registry version drift is detected
 * before the result can be sent to the model.
 */
export async function resolveApprovedSemanticContext(input: { database: D1Database; scope: EffectiveScope; catalog: AuthorizedSchemaCatalog; prompt: string }): Promise<ResolvedSemanticContext> {
  const startedAt = Date.now();
  const firstVersion = await registryVersion(input.database);
  const rows = await runtimeRows(input.database, firstVersion);
  if (rows.length > SEMANTIC_CONTEXT_LIMITS.candidateScan) return empty(firstVersion, input.catalog.schemaSnapshotId, startedAt, "SEMANTIC_CONTEXT_LIMIT_EXCEEDED", "OMITTED", [], rows.length, rows.length);
  if (rows.length === 0) return empty(firstVersion, input.catalog.schemaSnapshotId, startedAt);

  const revisionIds = rows.map((row) => row.revision_id);
  const [aliases, sources] = await Promise.all([aliasesFor(input.database, revisionIds), sourcesFor(input.database, revisionIds)]);
  const candidates: Candidate[] = [];
  let excludedCount = 0;
  for (const row of rows) {
    if (row.current_approved_revision_id !== row.revision_id || row.schema_snapshot_id !== input.catalog.schemaSnapshotId || row.runtime_eligibility !== "ELIGIBLE") { excludedCount += 1; continue; }
    try {
      const checked = validateContract(row.asset_type, JSON.parse(row.payload_json) as unknown);
      const candidateSources = sources.filter((source) => source.revision_id === row.revision_id);
      const expected = new Set(checked.normalizedSources.map(sourceKey));
      const actual = new Set(candidateSources.map(rowSourceKey));
      if (expected.size !== actual.size || [...expected].some((source) => !actual.has(source)) || candidateSources.some((source) => !catalogAllows(input.catalog, source) || !scopeAllows(input.scope, source))) { excludedCount += 1; continue; }
      candidates.push({ ...row, contract: checked.contract, aliases: aliases.filter((alias) => alias.revision_id === row.revision_id), sources: candidateSources });
    } catch { excludedCount += 1; }
  }

  const byRevision = new Map(candidates.map((candidate) => [candidate.revision_id, candidate]));
  const dependencyValid = (candidate: Candidate, visiting = new Set<string>()): boolean => {
    if (visiting.has(candidate.revision_id)) return false;
    const next = new Set(visiting).add(candidate.revision_id);
    return candidate.sources.filter((source) => source.source_kind === "SEMANTIC_DEPENDENCY").every((source) => {
      const dependency = source.referenced_revision_id ? byRevision.get(source.referenced_revision_id) : undefined;
      return Boolean(dependency && dependency.asset_id === source.referenced_asset_id && dependencyValid(dependency, next));
    });
  };
  const valid = candidates.filter((candidate) => dependencyValid(candidate));
  excludedCount += candidates.length - valid.length;
  const domain = requestedDomain(valid, input.prompt);
  const matching = valid.filter((candidate) => candidateMatchesPrompt(candidate, input.prompt) && (!domain || candidate.domain === domain));
  const toPublic = (candidate: Candidate): SemanticContextCandidate => ({ assetId: candidate.asset_id, revisionId: candidate.revision_id, assetType: candidate.asset_type, label: candidateLabel(candidate), domain: candidate.domain });
  if (matching.length === 0) return empty(firstVersion, input.catalog.schemaSnapshotId, startedAt, null, "OMITTED", [], valid.length, excludedCount);
  if (matching.length > 1) return empty(firstVersion, input.catalog.schemaSnapshotId, startedAt, "SEMANTIC_DOMAIN_AMBIGUOUS", "ASK", matching.slice(0, SEMANTIC_CONTEXT_LIMITS.assets).map(toPublic), valid.length, excludedCount);

  const selected = [matching[0]];
  const physicalTables = new Set(selected.flatMap((candidate) => candidate.sources.map((source) => source.table_name).filter((table): table is string => Boolean(table))));
  for (const candidate of valid.filter((candidate) => candidate.asset_type === "RELATIONSHIP" && candidate.revision_id !== selected[0].revision_id)) {
    if (selected.length >= SEMANTIC_CONTEXT_LIMITS.assets || selected.filter((entry) => entry.asset_type === "RELATIONSHIP").length >= SEMANTIC_CONTEXT_LIMITS.relationshipExpansions) break;
    const relationship = candidate.contract as Extract<SemanticContract, { leftTable: string; rightTable: string }>;
    if (physicalTables.has(relationship.leftTable) || physicalTables.has(relationship.rightTable)) selected.push(candidate);
  }
  const serialized = `<approved_semantics registry_version="${firstVersion}" schema_snapshot_id="${input.catalog.schemaSnapshotId}" contract="${APPROVED_SEMANTIC_CONTEXT_CONTRACT_VERSION}">\n${selected.map((candidate) => safeJson(projection(candidate, input.catalog.schemaSnapshotId))).join("\n")}\n</approved_semantics>`;
  const serializedBytes = new TextEncoder().encode(serialized).byteLength;
  if (serializedBytes > SEMANTIC_CONTEXT_LIMITS.serializedBytes) return empty(firstVersion, input.catalog.schemaSnapshotId, startedAt, "SEMANTIC_CONTEXT_LIMIT_EXCEEDED", "OMITTED", [], valid.length, excludedCount + selected.length);
  const finalVersion = await registryVersion(input.database);
  if (finalVersion !== firstVersion) return empty(finalVersion, input.catalog.schemaSnapshotId, startedAt, "SEMANTIC_REGISTRY_VERSION_DRIFT", "OMITTED", [], valid.length, excludedCount);
  return {
    status: "READY",
    code: null,
    registryVersion: firstVersion,
    schemaSnapshotId: input.catalog.schemaSnapshotId,
    modelContext: serialized,
    selected: selected.map((candidate) => evidenceSelection(candidate, input.catalog.schemaSnapshotId)),
    candidates: [],
    candidateCount: valid.length,
    excludedCount,
    fallbackToP1: false,
    serializedBytes,
    latencyMs: Date.now() - startedAt,
  };
}
