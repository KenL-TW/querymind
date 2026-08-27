import { expect, test } from "playwright/test";
import {
  activateApprovedRevision,
  acceptSemanticSuggestionAsDraft,
  createSemanticRevision,
  deprecateSemanticAsset,
  getSchemaSnapshotId,
  rejectSemanticRevision,
  recordSemanticReview,
  requestSemanticChanges,
  submitSemanticRevision,
  updateDraftRevision,
} from "../src/lib/semantic-repository";
import { validateAliases, validateContract, validateReviewComment } from "../src/lib/semantic-validation";
import { schemaSnapshotId } from "../src/lib/schema-catalog";
import type { SemanticContract } from "../src/lib/semantic-types";

const snapshot = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";

function metricContract(overrides: Partial<Record<string, unknown>> = {}): SemanticContract {
  return {
    canonicalName: "sales_revenue",
    displayName: "Sales revenue",
    definition: "The sum of item quantity multiplied by unit price.",
    domain: "sales",
    sources: [
      { ref: { table: "order_items", column: "quantity" }, role: "value" },
      { ref: { table: "order_items", column: "unit_price" }, role: "value" },
      { ref: { table: "orders", column: "ordered_at" }, role: "time" },
    ],
    expression: {
      kind: "SUM",
      argument: {
        kind: "MULTIPLY",
        left: { kind: "COLUMN", source: { table: "order_items", column: "quantity" } },
        right: { kind: "COLUMN", source: { table: "order_items", column: "unit_price" } },
      },
    },
    defaultFilters: [{ field: { table: "orders", column: "status" }, operator: "EQ", value: "paid" }],
    nativeGrain: { kind: "ENTITY", key: "order_item", source: { table: "order_items", keyColumns: ["id"] } },
    timeDimension: { table: "orders", column: "ordered_at" },
    unit: "CURRENCY",
    currency: "TWD",
    semanticDependencies: [],
    ...overrides,
  } as SemanticContract;
}

test.describe("P2-A semantic contract validation", () => {
  test("accepts bounded metric arithmetic and extracts physical leaves", () => {
    const result = validateContract("METRIC", metricContract());
    expect(result.contract).toHaveProperty("expression");
    expect(result.normalizedSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: "COLUMN", tableName: "order_items", columnName: "quantity" }),
      expect.objectContaining({ sourceKind: "COLUMN", tableName: "order_items", columnName: "unit_price" }),
      expect.objectContaining({ sourceKind: "COLUMN", tableName: "orders", columnName: "status", role: "default_filter" }),
      expect.objectContaining({ sourceKind: "COLUMN", tableName: "order_items", columnName: "id", role: "grain" }),
    ]));
    expect(result.normalizedSources.some((source) => source.sourceKind === "EXPRESSION")).toBe(false);
  });

  test("supports explicit count forms and deterministic divide behavior", () => {
    for (const expression of [
      { kind: "COUNT", mode: "ROWS" },
      { kind: "COUNT", mode: "COLUMN", source: { table: "orders", column: "id" } },
      { kind: "COUNT_DISTINCT", source: { table: "customers", column: "id" } },
      { kind: "DIVIDE", left: { kind: "SUM", argument: { kind: "COLUMN", source: { table: "orders", column: "total" } } }, right: { kind: "LITERAL", value: 0 }, divisionByZero: "NULL" },
    ]) {
      expect(() => validateContract("METRIC", metricContract({ expression }))).not.toThrow();
    }
  });

  test("rejects arbitrary SQL, unsupported operators, unsafe sources, and unbounded ASTs", () => {
    expect(() => validateContract("METRIC", metricContract({ expression: { kind: "SQL", sql: "SUM(total)" } }))).toThrow();
    expect(() => validateContract("METRIC", metricContract({ expression: { kind: "DIVIDE", left: { kind: "LITERAL", value: 1 }, right: { kind: "LITERAL", value: 0 } } }))).toThrow(/divisionByZero/iu);
    expect(() => validateContract("METRIC", metricContract({ expression: { kind: "COLUMN", source: { table: "orders;DROP", column: "total" } } }))).toThrow();
    expect(() => validateContract("METRIC", metricContract({ rowPolicy: "tenant_id = 1" }))).toThrow();
    let nested: Record<string, unknown> = { kind: "LITERAL", value: 1 };
    for (let index = 0; index < 20; index += 1) nested = { kind: "SUM", argument: nested };
    expect(() => validateContract("METRIC", metricContract({ expression: nested }))).toThrow(/depth/iu);
  });

  test("requires deterministic physical grain anchors and validates relationships", () => {
    expect(() => validateContract("METRIC", metricContract({ nativeGrain: { kind: "ENTITY", key: "free_text" } }))).toThrow();
    expect(() => validateContract("METRIC", metricContract({ nativeGrain: { kind: "TIME", key: "order_day", source: { table: "orders", column: "ordered_at" }, timeUnit: "hour" } }))).toThrow();
    const relationship: SemanticContract = {
      canonicalName: "customer_orders",
      displayName: "Customer orders",
      definition: "Customers own orders.",
      domain: "sales",
      leftTable: "customers",
      rightTable: "orders",
      cardinality: "ONE_TO_MANY",
      joinKeys: [
        { leftTable: "customers", leftColumn: "id", rightTable: "orders", rightColumn: "customer_id" },
      ],
      semanticDependencies: [],
    };
    const result = validateContract("RELATIONSHIP", relationship);
    expect(result.normalizedSources).toEqual(expect.arrayContaining([
      expect.objectContaining({ sourceKind: "TABLE", tableName: "customers" }),
      expect.objectContaining({ sourceKind: "COLUMN", tableName: "orders", columnName: "customer_id" }),
    ]));
    expect(() => validateContract("RELATIONSHIP", { ...relationship, joinKeys: [{ ...relationship.joinKeys[0], rightTable: "products" }] })).toThrow();
    expect(() => validateContract("RELATIONSHIP", { ...relationship, joinKeys: [relationship.joinKeys[0], relationship.joinKeys[0]] })).toThrow();
    expect(() => validateContract("RELATIONSHIP", { ...relationship, conditionalJoin: "x" })).toThrow();
  });

  test("rejects duplicate aliases and preserves exact dependency pins", () => {
    expect(() => validateAliases([{ alias: "Revenue" }, { alias: "revenue" }])).toThrow(/duplicate/iu);
    const result = validateContract("TERM", {
      canonicalName: "customer_segment",
      displayName: "Customer segment",
      definition: "Pinned semantic term.",
      domain: "sales",
      semanticDependencies: [{ referencedAssetId: "asset-1", referencedRevisionId: "revision-7" }],
    });
    expect(result.normalizedSources).toContainEqual(expect.objectContaining({ sourceKind: "SEMANTIC_DEPENDENCY", referencedAssetId: "asset-1", referencedRevisionId: "revision-7" }));
  });
});

type FakePrepared = {
  bind(...values: unknown[]): FakePrepared;
  first<T>(): Promise<T | null>;
  run(): Promise<{ meta: { changes: number } }>;
  sql: string;
  values: unknown[];
};

function fakeDatabase(options: {
  first?: (sql: string, values: unknown[]) => unknown;
  runChanges?: number;
  batchChanges?: number[];
}) {
  const batches: string[][] = [];
  const database = {
    prepare(sql: string): FakePrepared {
      const prepared: FakePrepared = {
        sql,
        values: [],
        bind(...values: unknown[]) { prepared.values = values; return prepared; },
        async first<T>() { return (options.first?.(sql, prepared.values) ?? null) as T | null; },
        async run() { return { meta: { changes: options.runChanges ?? 1 } }; },
      };
      return prepared;
    },
    async batch(statements: FakePrepared[]) {
      batches.push(statements.map((statement) => statement.sql));
      return statements.map((_, index) => ({ meta: { changes: options.batchChanges?.[index] ?? 1 } }));
    },
  };
  return { database: database as unknown as D1Database, batches };
}

test.describe("P2-A repository and atomicity primitives", () => {
  test("requires an approved exact revision for semantic dependencies", async () => {
    const { database, batches } = fakeDatabase({
      first: (sql) => sql.includes("FROM semantic_assets") ? { asset_id: "asset-1", asset_type: "TERM", asset_status: "ACTIVE", canonical_name: "customer_segment", display_name: "Customer segment", max_revision: 0 } : null,
    });
    await expect(createSemanticRevision(database, {
      assetId: "asset-1",
      createdBy: "user-1",
      schemaSnapshotId: snapshot,
      contract: {
        canonicalName: "customer_segment",
        displayName: "Customer segment",
        definition: "Pinned semantic term.",
        domain: "sales",
        semanticDependencies: [{ referencedAssetId: "dependency-asset", referencedRevisionId: "dependency-revision" }],
      },
    })).rejects.toMatchObject({ code: "SEMANTIC_DEPENDENCY_NOT_APPROVED" });
    expect(batches).toHaveLength(0);
  });

  test("does not mutate an approved revision", async () => {
    const { database, batches } = fakeDatabase({ first: () => ({ revision_id: "revision-1", asset_id: "asset-1", asset_type: "TERM", revision_status: "APPROVED", payload_json: "{}", schema_snapshot_id: snapshot, canonical_name: "customer_segment", display_name: "Customer segment" }) });
    await expect(updateDraftRevision(database, { revisionId: "revision-1", changeReason: "attempt" })).rejects.toMatchObject({ code: "SEMANTIC_REVISION_IMMUTABLE" });
    expect(batches).toHaveLength(0);
  });

  test("keeps an ACTIVE asset's current approval while creating a new DRAFT", async () => {
    const { database, batches } = fakeDatabase({
      first: (sql) => sql.includes("FROM semantic_assets") ? { asset_id: "asset-1", asset_type: "TERM", asset_status: "ACTIVE", canonical_name: "customer_segment", display_name: "Customer segment", max_revision: 3 } : null,
    });
    const result = await createSemanticRevision(database, {
      assetId: "asset-1",
      createdBy: "user-1",
      schemaSnapshotId: snapshot,
      contract: {
        canonicalName: "customer_segment",
        displayName: "Customer segment",
        definition: "A new draft meaning.",
        domain: "sales",
        semanticDependencies: [],
      },
    });
    expect(result.revisionNumber).toBe(4);
    expect(batches).toHaveLength(1);
    expect(batches[0].some((sql) => sql.includes("current_approved_revision_id"))).toBe(false);
    expect(batches[0].some((sql) => sql.includes("registry_version"))).toBe(false);
  });

  test("deprecates an asset without deleting historical revisions and advances the registry", async () => {
    const { database, batches } = fakeDatabase({ first: (sql) => sql.includes("semantic_registry_state") ? { registry_version: 4 } : null, batchChanges: [1, 1, 1] });
    const result = await deprecateSemanticAsset(database, "asset-1", "reviewer-1");
    expect(result.registryVersion).toBe(4);
    expect(batches[0][0]).toContain("asset_status = 'DEPRECATED'");
    expect(batches[0].some((sql) => sql.includes("DELETE FROM semantic_revisions"))).toBe(false);
  });

  test("uses one D1 batch for guarded approval, pointer switch, registry epoch and review event", async () => {
    const contract = metricContract();
    const { database, batches } = fakeDatabase({
      first: (sql) => sql.includes("FROM semantic_revisions r") ? { revision_id: "revision-2", asset_id: "asset-1", asset_type: "METRIC", revision_number: 2, revision_status: "IN_REVIEW", payload_json: JSON.stringify(contract), schema_snapshot_id: snapshot } : sql.includes("semantic_registry_state") ? { registry_version: 1 } : null,
      batchChanges: [1, 1, 1, 1],
    });
    const result = await activateApprovedRevision(database, { assetId: "asset-1", revisionId: "revision-2", revisionNumber: 2, approvedBy: "reviewer-1", expectedSchemaSnapshotId: snapshot });
    expect(result.registryVersion).toBe(1);
    expect(batches).toHaveLength(1);
    expect(batches[0].some((sql) => sql.includes("registry_version = registry_version + 1"))).toBe(true);
    expect(batches[0].some((sql) => sql.includes("current_approved_revision_id"))).toBe(true);
  });

  test("fails approval without reporting a version when atomic preconditions fail", async () => {
    const { database, batches } = fakeDatabase({
      first: (sql) => sql.includes("FROM semantic_revisions r") ? { revision_id: "revision-2", asset_id: "asset-1", asset_type: "TERM", revision_number: 2, revision_status: "IN_REVIEW", payload_json: JSON.stringify({ canonicalName: "customer_segment", displayName: "Customer segment", definition: "Pinned semantic term.", domain: "sales", semanticDependencies: [] }), schema_snapshot_id: snapshot } : null,
      batchChanges: [0, 0, 0, 0],
    });
    await expect(activateApprovedRevision(database, { assetId: "asset-1", revisionId: "revision-2", revisionNumber: 2, approvedBy: "reviewer-1" })).rejects.toMatchObject({ code: "SEMANTIC_APPROVAL_CONFLICT" });
    expect(batches).toHaveLength(1);
  });

  test("stores review events through a bounded immutable primitive", async () => {
    const { database } = fakeDatabase({ runChanges: 1 });
    await expect(recordSemanticReview(database, { revisionId: "revision-1", action: "REQUEST_CHANGES", reviewerUserId: "reviewer-1", comment: "Add a deterministic grain." })).resolves.toMatch(/[0-9a-f-]{36}/iu);
  });

  test("guards review transitions and rejects unsafe review text", async () => {
    const { database, batches } = fakeDatabase({ batchChanges: [1, 1] });
    await expect(requestSemanticChanges(database, { revisionId: "revision-1", reviewerUserId: "reviewer-1", comment: "Please clarify the grain." })).resolves.toMatch(/[0-9a-f-]{36}/iu);
    await expect(rejectSemanticRevision(database, { revisionId: "revision-1", reviewerUserId: "reviewer-1", comment: "Reject this revision." })).resolves.toMatch(/[0-9a-f-]{36}/iu);
    expect(batches[0][0]).toContain("revision_status = 'DRAFT'");
    expect(batches[1][0]).toContain("revision_status = 'REJECTED'");
    expect(batches.flat().some((sql) => sql.includes("registry_version"))).toBe(false);
    expect(batches.flat().some((sql) => sql.includes("current_approved_revision_id"))).toBe(false);
    expect(() => validateReviewComment("unsafe\u0000comment")).toThrow(/control/iu);
  });

  test("keeps the registry epoch unchanged across draft submission", async () => {
    const { database, batches } = fakeDatabase({ batchChanges: [1, 1] });
    await submitSemanticRevision(database, "revision-1", "manager-1");
    expect(batches[0]).toHaveLength(2);
    expect(batches.flat().some((sql) => sql.includes("registry_version"))).toBe(false);
    expect(batches.flat().some((sql) => sql.includes("current_approved_revision_id"))).toBe(false);
  });
});

test("P2-D accept-as-Draft is atomic and never advances the semantic registry epoch", async () => {
  const { database, batches } = fakeDatabase({
    first: (sql) => sql.includes("schema_catalog_state") ? { schema_snapshot_id: snapshot } : null,
    batchChanges: Array(16).fill(1),
  });
  const result = await acceptSemanticSuggestionAsDraft(database, {
    suggestionId: "suggestion-1",
    acceptedBy: "user-1",
    expectedSuggestionSnapshotId: snapshot,
    promptFingerprint: "a".repeat(64),
    modelConfigFingerprint: "b".repeat(64),
    assetType: "TERM",
    canonicalName: "order_term",
    displayName: "Order term",
    ownerUserId: "user-1",
    createdBy: "user-1",
    schemaSnapshotId: snapshot,
    contract: { canonicalName: "order_term", displayName: "Order term", definition: "A human-reviewed suggestion.", domain: "", semanticDependencies: [] },
    aliases: [],
  });
  expect(result.revisionNumber).toBe(1);
  expect(batches).toHaveLength(1);
  expect(batches[0].some((sql) => sql.includes("UPDATE semantic_suggestions SET status = 'ACCEPTED'"))).toBe(true);
  expect(batches[0].some((sql) => sql.includes("INSERT INTO audit_events"))).toBe(true);
  expect(batches[0].some((sql) => sql.includes("semantic_registry_state"))).toBe(false);
});

test("P2-D accept-as-Draft fails closed when the schema snapshot is stale", async () => {
  const { database, batches } = fakeDatabase({
    first: (sql) => sql.includes("schema_catalog_state") ? { schema_snapshot_id: "b".repeat(64) } : null,
    batchChanges: Array(16).fill(1),
  });
  await expect(acceptSemanticSuggestionAsDraft(database, {
    suggestionId: "suggestion-1", acceptedBy: "user-1", expectedSuggestionSnapshotId: snapshot,
    promptFingerprint: "a".repeat(64), modelConfigFingerprint: "b".repeat(64), assetType: "TERM",
    canonicalName: "order_term", displayName: "Order term", ownerUserId: "user-1", createdBy: "user-1",
    schemaSnapshotId: snapshot, contract: { canonicalName: "order_term", displayName: "Order term", definition: "A human-reviewed suggestion.", domain: "", semanticDependencies: [] }, aliases: [],
  })).rejects.toMatchObject({ code: "SEMANTIC_SCHEMA_STALE" });
  expect(batches).toHaveLength(0);
});

test("schema snapshot identity is deterministic and changes with DDL", async () => {
  const first = await schemaSnapshotId([{ name: "orders", sql: "CREATE TABLE orders(id TEXT)" }, { name: "customers", sql: "CREATE TABLE customers(id TEXT)" }]);
  const same = await schemaSnapshotId([{ name: "customers", sql: "CREATE TABLE customers(id TEXT)" }, { name: "orders", sql: "CREATE TABLE orders(id TEXT)" }]);
  const changed = await schemaSnapshotId([{ name: "orders", sql: "CREATE TABLE orders(id TEXT, total INTEGER)" }, { name: "customers", sql: "CREATE TABLE customers(id TEXT)" }]);
  expect(first).toBe(same);
  expect(changed).not.toBe(first);
  expect(first).toMatch(/^[0-9a-f]{64}$/u);
});

test("uninitialized schema snapshots fail closed", async () => {
  const { database } = fakeDatabase({ first: () => ({ schema_snapshot_id: "uninitialized" }) });
  await expect(getSchemaSnapshotId(database)).rejects.toMatchObject({ code: "SCHEMA_SNAPSHOT_UNAVAILABLE" });
});
