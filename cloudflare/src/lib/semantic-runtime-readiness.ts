import { SEMANTIC_EVIDENCE_LIMITS, semanticEvidenceForRun } from "./explainability";
import { policyState } from "./scope";

export type ReadinessStatus = "PASS" | "NOT_READY" | "BLOCKED";

export interface SemanticRuntimeReadiness {
  ready: boolean;
  status: "READY" | "NOT_READY" | "BLOCKED";
  runtimeCapability: "AVAILABLE";
  activationCurrentState: "DISABLED" | "ENABLED";
  registryVersion: number | null;
  checks: {
    featureFlag: { status: ReadinessStatus; code: string };
    schemaSnapshot: { status: ReadinessStatus; code: string };
    registry: { status: ReadinessStatus; code: string; approvedEligibleAssets: number };
    dependencies: { status: ReadinessStatus; code: string };
    policyEngine: { status: ReadinessStatus; code: string };
    evidenceHook: { status: ReadinessStatus; code: string };
    database: { status: ReadinessStatus; code: string };
    operatorGate: { status: "NOT_EXECUTED"; code: "AUTHENTICATED_OPERATOR_SMOKE_REQUIRED" };
  };
  blockers: string[];
  warnings: string[];
}

interface StateRow { registry_version: number; }
interface SnapshotRow { schema_snapshot_id: string | null; table_count: number | null; }
interface CountRow { total: number; }
interface IntegrityRow { total: number; }

const code = (status: ReadinessStatus, value: string) => ({ status, code: value });

/**
 * Read-only P2-H activation gate. It deliberately verifies structural runtime
 * eligibility, never a union of user permissions. P2-F still filters each
 * request through EffectiveScope and the authorized catalog.
 */
export async function semanticRuntimeActivationReadiness(env: Env): Promise<SemanticRuntimeReadiness> {
  const flagEnabled = env.SEMANTIC_RUNTIME_CONTEXT_ENABLED === "true";
  const [policy, registry, snapshot, eligiblePublished, approved, invalidSources, invalidDependencies, appTables, dataTables] = await Promise.all([
    policyState(env),
    env.QUERYMIND_APP.prepare("SELECT registry_version FROM semantic_registry_state WHERE state_key = 'global'").first<StateRow>(),
    env.QUERYMIND_APP.prepare("SELECT schema_snapshot_id, table_count FROM schema_catalog_state WHERE id = 1").first<SnapshotRow>(),
    env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM semantic_assets a JOIN semantic_revisions r ON r.revision_id = a.current_approved_revision_id AND r.asset_id = a.asset_id JOIN semantic_publications p ON p.asset_id = a.asset_id AND p.revision_id = r.revision_id WHERE a.asset_status = 'ACTIVE' AND r.revision_status = 'APPROVED' AND p.runtime_eligibility = 'ELIGIBLE'").first<CountRow>(),
    env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM semantic_assets a JOIN semantic_revisions r ON r.revision_id = a.current_approved_revision_id AND r.asset_id = a.asset_id JOIN semantic_publications p ON p.asset_id = a.asset_id AND p.revision_id = r.revision_id JOIN schema_catalog_state sc ON sc.id = 1 AND sc.schema_snapshot_id = r.schema_snapshot_id WHERE a.asset_status = 'ACTIVE' AND r.revision_status = 'APPROVED' AND p.runtime_eligibility = 'ELIGIBLE'").first<CountRow>(),
    env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM semantic_assets a JOIN semantic_revisions r ON r.revision_id = a.current_approved_revision_id AND r.asset_id = a.asset_id JOIN semantic_publications p ON p.asset_id = a.asset_id AND p.revision_id = r.revision_id JOIN semantic_sources s ON s.revision_id = r.revision_id WHERE a.asset_status = 'ACTIVE' AND r.revision_status = 'APPROVED' AND p.runtime_eligibility = 'ELIGIBLE' AND ((s.source_kind = 'TABLE' AND NOT EXISTS (SELECT 1 FROM schema_catalog_tables t WHERE t.table_name = s.table_name)) OR (s.source_kind = 'COLUMN' AND NOT EXISTS (SELECT 1 FROM schema_catalog_columns c WHERE c.table_name = s.table_name AND c.column_name = s.column_name)))").first<IntegrityRow>(),
    env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM semantic_assets a JOIN semantic_revisions r ON r.revision_id = a.current_approved_revision_id AND r.asset_id = a.asset_id JOIN semantic_publications p ON p.asset_id = a.asset_id AND p.revision_id = r.revision_id JOIN semantic_sources s ON s.revision_id = r.revision_id WHERE a.asset_status = 'ACTIVE' AND r.revision_status = 'APPROVED' AND p.runtime_eligibility = 'ELIGIBLE' AND s.source_kind = 'SEMANTIC_DEPENDENCY' AND NOT EXISTS (SELECT 1 FROM semantic_assets da JOIN semantic_revisions dr ON dr.revision_id = da.current_approved_revision_id AND dr.asset_id = da.asset_id JOIN semantic_publications dp ON dp.asset_id = da.asset_id AND dp.revision_id = dr.revision_id WHERE da.asset_id = s.referenced_asset_id AND dr.revision_id = s.referenced_revision_id AND da.asset_status = 'ACTIVE' AND dr.revision_status = 'APPROVED' AND dp.runtime_eligibility = 'ELIGIBLE')").first<IntegrityRow>(),
    env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'table' AND name IN ('semantic_assets', 'semantic_revisions', 'semantic_sources', 'semantic_registry_state', 'semantic_publications', 'query_runs')").first<CountRow>(),
    env.QUERYMIND_DATA.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'").first<CountRow>(),
  ]);

  const registryVersion = registry?.registry_version ?? null;
  const schemaOk = Boolean(snapshot?.schema_snapshot_id && snapshot.schema_snapshot_id !== "uninitialized" && (snapshot.table_count ?? 0) > 0);
  const databaseOk = (appTables?.total ?? 0) === 6 && (dataTables?.total ?? 0) > 0;
  const approvedEligibleAssets = approved?.total ?? 0;
  const eligiblePublishedAssets = eligiblePublished?.total ?? 0;
  const structuralIntegrity = (invalidSources?.total ?? 0) === 0 && (invalidDependencies?.total ?? 0) === 0;
  const contentStatus: ReadinessStatus = approvedEligibleAssets === 0 ? "NOT_READY" : !schemaOk || !structuralIntegrity ? "BLOCKED" : "PASS";
  const contentCode = approvedEligibleAssets === 0 ? eligiblePublishedAssets > 0 ? "SEMANTIC_SCHEMA_STALE" : "NO_APPROVED_SEMANTIC" : !schemaOk ? "SCHEMA_SNAPSHOT_UNAVAILABLE" : !structuralIntegrity ? "SEMANTIC_INTEGRITY_BLOCKED" : "APPROVED_SEMANTIC_AVAILABLE";
  const evidenceOk = SEMANTIC_EVIDENCE_LIMITS.serializedBytes > 0 && semanticEvidenceForRun(null).mode === "NOT_USED";
  const blockers = [
    ...(!databaseOk ? ["DATABASE_UNAVAILABLE"] : []),
    ...(!policy.ok ? ["POLICY_ENGINE_UNAVAILABLE"] : []),
    ...(!schemaOk ? ["SCHEMA_SNAPSHOT_UNAVAILABLE"] : []),
    ...(contentStatus === "NOT_READY" ? ["NO_APPROVED_SEMANTIC"] : []),
    ...(contentStatus === "BLOCKED" ? [contentCode] : []),
    ...(!evidenceOk ? ["EVIDENCE_HOOK_UNAVAILABLE"] : []),
  ];
  const platformBlocked = !databaseOk || !policy.ok || !schemaOk || !evidenceOk;
  const ready = !platformBlocked && contentStatus === "PASS";
  return {
    ready,
    status: ready ? "READY" : platformBlocked || contentStatus === "BLOCKED" ? "BLOCKED" : "NOT_READY",
    runtimeCapability: "AVAILABLE",
    activationCurrentState: flagEnabled ? "ENABLED" : "DISABLED",
    registryVersion,
    checks: {
      featureFlag: code("PASS", flagEnabled ? "RUNTIME_FLAG_ENABLED" : "RUNTIME_CAPABLE_ACTIVATION_DISABLED"),
      schemaSnapshot: code(schemaOk ? "PASS" : "BLOCKED", schemaOk ? "SCHEMA_SNAPSHOT_CURRENT" : "SCHEMA_SNAPSHOT_UNAVAILABLE"),
      registry: { ...code(contentStatus, contentCode), approvedEligibleAssets },
      dependencies: code(structuralIntegrity ? "PASS" : "BLOCKED", structuralIntegrity ? "DEPENDENCIES_RESOLVE" : "DEPENDENCY_OR_SOURCE_INVALID"),
      policyEngine: code(policy.ok ? "PASS" : "BLOCKED", policy.ok ? "QUERY_POLICY_ENGINE_READY" : "POLICY_ENGINE_UNAVAILABLE"),
      evidenceHook: code(evidenceOk ? "PASS" : "BLOCKED", evidenceOk ? "P2G_OBSERVATIONAL_EVIDENCE_READY" : "EVIDENCE_HOOK_UNAVAILABLE"),
      database: code(databaseOk ? "PASS" : "BLOCKED", databaseOk ? "D1_BINDINGS_AND_SCHEMA_READY" : "DATABASE_UNAVAILABLE"),
      operatorGate: { status: "NOT_EXECUTED", code: "AUTHENTICATED_OPERATOR_SMOKE_REQUIRED" },
    },
    blockers,
    warnings: ["Activation requires a separately authorized configuration release.", "Readiness does not evaluate or grant any user data authorization."],
  };
}
