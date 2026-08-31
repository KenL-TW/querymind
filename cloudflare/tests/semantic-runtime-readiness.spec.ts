import { expect, test } from "playwright/test";
import { semanticRuntimeActivationReadiness } from "../src/lib/semantic-runtime-readiness";
import { semanticEvidenceForRun } from "../src/lib/explainability";
import type { ResolvedSemanticContext } from "../src/lib/approved-semantic-context";

const snapshot = "a".repeat(64);

function readinessEnv(options: { flag?: string; approved?: number; eligible?: number; invalid?: number; policy?: boolean; snapshot?: boolean } = {}): Env {
  const first = (sql: string) => {
    if (sql.includes("semantic_registry_state")) return { registry_version: options.approved ? 4 : 0 };
    if (sql.includes("schema_catalog_state")) return { schema_snapshot_id: options.snapshot === false ? "uninitialized" : snapshot, table_count: 14 };
    if (sql.includes("COUNT(*) AS total FROM semantic_assets") && sql.includes("semantic_sources")) return { total: options.invalid ?? 0 };
    if (sql.includes("COUNT(*) AS total FROM semantic_assets") && sql.includes("schema_catalog_state sc")) return { total: options.approved ?? 0 };
    if (sql.includes("COUNT(*) AS total FROM semantic_assets")) return { total: options.eligible ?? options.approved ?? 0 };
    if (sql.includes("sqlite_schema") && sql.includes("semantic_assets")) return { total: 6 };
    if (sql.includes("sqlite_schema")) return { total: 14 };
    if (sql.includes("policy_state")) return { policy_version: options.policy === false ? "" : "p0-governed-query-safety-core-v1", expected_migration: "0006" };
    if (sql.includes("data_scope_policies")) return { total: options.policy === false ? 0 : 72 };
    return null;
  };
  const database = { prepare(sql: string) { const statement = { bind(..._values: unknown[]) { return statement; }, async first<T>() { return first(sql) as T; } }; return statement; } } as unknown as D1Database;
  return { ENVIRONMENT: "local", SEMANTIC_RUNTIME_CONTEXT_ENABLED: options.flag ?? "false", QUERYMIND_APP: database, QUERYMIND_DATA: database } as Env;
}

function readyContext(): ResolvedSemanticContext {
  return { status: "READY", code: null, registryVersion: 4, schemaSnapshotId: snapshot, modelContext: "<approved_semantics />", selected: [{ assetId: "asset-sales", revisionId: "revision-1", assetType: "METRIC", label: "Sales", canonicalName: "sales", domain: "sales", schemaSnapshotId: snapshot, sources: [{ table: "orders", column: "total" }], metricAstSummary: "SUM(orders.total)" }], candidates: [], candidateCount: 1, excludedCount: 0, fallbackToP1: false, serializedBytes: 100, latencyMs: 1 };
}

test.describe("P2-H Semantic Runtime Activation Readiness", () => {
  test("reports empty production-like registry as platform healthy but content NOT_READY", async () => {
    const readiness = await semanticRuntimeActivationReadiness(readinessEnv());
    expect(readiness).toMatchObject({ ready: false, status: "NOT_READY", runtimeCapability: "AVAILABLE", activationCurrentState: "DISABLED", registryVersion: 0 });
    expect(readiness.checks.registry).toMatchObject({ status: "NOT_READY", code: "NO_APPROVED_SEMANTIC", approvedEligibleAssets: 0 });
    expect(readiness.blockers).toEqual(["NO_APPROVED_SEMANTIC"]);
  });

  test("requires structurally valid approved semantics before readiness can pass", async () => {
    const ready = await semanticRuntimeActivationReadiness(readinessEnv({ flag: "true", approved: 1 }));
    expect(ready).toMatchObject({ ready: true, status: "READY", activationCurrentState: "ENABLED" });
    const blocked = await semanticRuntimeActivationReadiness(readinessEnv({ approved: 1, invalid: 1 }));
    expect(blocked).toMatchObject({ ready: false, status: "BLOCKED" });
    expect(blocked.checks.dependencies.status).toBe("BLOCKED");
    const stale = await semanticRuntimeActivationReadiness(readinessEnv({ eligible: 1, approved: 0 }));
    expect(stale.checks.registry).toMatchObject({ status: "NOT_READY", code: "SEMANTIC_SCHEMA_STALE" });
  });

  test("true semantic-path evidence remains exact and observational", () => {
    const evidence = semanticEvidenceForRun(readyContext());
    expect(evidence).toMatchObject({ mode: "USED", registryVersion: 4, schemaSnapshotId: snapshot, selections: [expect.objectContaining({ assetId: "asset-sales", revisionId: "revision-1" })] });
    expect(JSON.stringify(evidence)).not.toContain("scopeKey");
  });
});
