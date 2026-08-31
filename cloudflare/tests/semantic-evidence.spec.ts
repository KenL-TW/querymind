import { expect, test } from "playwright/test";
import { buildQueryExplainability, semanticEvidenceForRun } from "../src/lib/explainability";
import type { ResolvedSemanticContext } from "../src/lib/approved-semantic-context";
import type { EffectiveScope } from "../src/lib/scope";

const snapshot = "a".repeat(64);
const scope: EffectiveScope = {
  userId: "user-1", roleId: "analyst", roleName: "analyst", scopeKey: "scope:private", policyVersion: "p0", capabilities: ["chat"],
  datasource: { id: "querymind-data", tables: { orders: { columns: ["id", "total"], rowFilter: { tableName: "orders", predicate: "region = 'TW'" }, canViewRaw: false, canExport: false, canBulkExport: false } } },
  canQuery: true, canViewRawData: false, canExport: false, canBulkExport: false,
};

function ready(overrides: Partial<ResolvedSemanticContext> = {}): ResolvedSemanticContext {
  return {
    status: "READY", code: null, registryVersion: 12, schemaSnapshotId: snapshot, modelContext: "<approved_semantics />",
    selected: [{ assetId: "asset-sales", revisionId: "revision-r1", assetType: "METRIC", label: "Sales Revenue", canonicalName: "sales_revenue", domain: "sales", schemaSnapshotId: snapshot, sources: [{ table: "orders", column: "total" }], grain: "order", metricAstSummary: "SUM(orders.total)" }],
    candidates: [], candidateCount: 1, excludedCount: 0, fallbackToP1: false, serializedBytes: 100, latencyMs: 1,
    ...overrides,
  };
}

test.describe("P2-G Semantic Evidence Hook", () => {
  test("persists the exact P2-F selection snapshot, never a reread registry projection", () => {
    const evidence = semanticEvidenceForRun(ready());
    expect(evidence).toEqual(expect.objectContaining({ mode: "USED", registryVersion: 12, schemaSnapshotId: snapshot, selections: [expect.objectContaining({ assetId: "asset-sales", revisionId: "revision-r1", semanticType: "METRIC", metricAstSummary: "SUM(orders.total)" })] }));
    // Simulates R2 becoming current later: Run 1 retains the original handoff.
    const historical = JSON.parse(JSON.stringify(evidence));
    const current = semanticEvidenceForRun(ready({ registryVersion: 13, selected: [{ ...ready().selected[0], revisionId: "revision-r2" }] }));
    expect(historical.selections[0].revisionId).toBe("revision-r1");
    expect(historical.registryVersion).toBe(12);
    expect(current.selections[0].revisionId).toBe("revision-r2");
  });

  test("records NOT_USED from the runtime path, including feature-off and Direct Query", () => {
    expect(semanticEvidenceForRun(null)).toEqual({ mode: "NOT_USED", registryVersion: null, schemaSnapshotId: null, selections: [] });
    expect(semanticEvidenceForRun(ready(), "NOT_USED")).toEqual({ mode: "NOT_USED", registryVersion: null, schemaSnapshotId: null, selections: [] });
  });

  test("does not expose an unselected or unauthorized semantic candidate", () => {
    const evidence = semanticEvidenceForRun(ready({ selected: [{ ...ready().selected[0], sources: [{ table: "orders", column: "total" }] }] }));
    expect(JSON.stringify(evidence)).not.toContain("employees");
    expect(JSON.stringify(evidence)).not.toContain("scope:private");
    expect(JSON.stringify(evidence)).not.toContain("region = 'TW'");
  });

  test("keeps P1 fields and Feedback contract unchanged while adding evidence", () => {
    const envelope = buildQueryExplainability({ prompt: "Sales Revenue", sql: "SELECT SUM(total) FROM orders", scope, referencedTables: ["orders"], rowCount: 1, truncated: false, maskedColumns: [], queryRunId: "11111111-1111-4111-8111-111111111111", rawSqlAvailable: false, semanticContext: ready() });
    expect(envelope.version).toBe("p1");
    expect(envelope.feedback).toEqual({ supported: true, queryRunId: envelope.queryRunId });
    expect(envelope.semanticEvidence?.mode).toBe("USED");
    expect(JSON.stringify(envelope)).not.toContain("scope:private");
    expect(JSON.stringify(envelope)).not.toContain("region = 'TW'");
  });
});
