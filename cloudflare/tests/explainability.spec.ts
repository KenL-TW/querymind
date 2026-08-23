import { expect, test } from "playwright/test";
import { buildQueryExplainability } from "../src/lib/explainability";
import { submitQueryFeedback } from "../src/routes/feedback";
import type { EffectiveScope } from "../src/lib/scope";

const scope: EffectiveScope = {
  userId: "local-anonymous", roleId: "viewer", roleName: "viewer", scopeKey: "scope:tw", policyVersion: "test", capabilities: ["chat"],
  datasource: { id: "querymind-data", tables: { orders: { columns: ["id", "shipping_city", "total"], rowFilter: { tableName: "orders", predicate: "shipping_city = 'Taipei'" }, canViewRaw: false, canExport: false, canBulkExport: false } } },
  canQuery: true, canViewRawData: false, canExport: false, canBulkExport: false,
};

test.describe("P1 explainability contract", () => {
  test("returns structured understanding and deterministic governance without predicates or scope keys", () => {
    const envelope = buildQueryExplainability({ prompt: "依城市整理未取消訂單營收", sql: "SELECT shipping_city, SUM(total) AS revenue FROM orders GROUP BY shipping_city", scope, referencedTables: ["orders"], rowCount: 3, truncated: false, maskedColumns: [], queryRunId: "11111111-1111-4111-8111-111111111111", rawSqlAvailable: false });
    expect(envelope.version).toBe("p1");
    expect(envelope.understanding.metrics).toContain("sales amount");
    expect(envelope.sources.governance).toMatchObject({ scopeApplied: true, rowPolicyApplied: true, columnPolicyApplied: true, dlpApplied: true });
    expect(JSON.stringify(envelope)).not.toContain("scope:tw");
    expect(JSON.stringify(envelope)).not.toContain("shipping_city = 'Taipei'");
    expect(envelope.explanation).not.toHaveProperty("sql");
  });

  test("raw SQL is available only when explicitly authorized", () => {
    const envelope = buildQueryExplainability({ prompt: null, sql: "SELECT id FROM orders", scope, referencedTables: ["orders"], rowCount: 1, truncated: false, maskedColumns: [], queryRunId: "22222222-2222-4222-8222-222222222222", rawSqlAvailable: true });
    expect(envelope.explanation).toMatchObject({ rawSqlAvailable: true, sql: "SELECT id FROM orders" });
  });
});

function feedbackEnv(runUserId = "local-anonymous") {
  const calls: string[] = [];
  const database = {
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind(...values: unknown[]) { (this as { values?: unknown[] }).values = values; return this; },
        values: [] as unknown[],
        async first() { return sql.includes("SELECT id, user_id, outcome") ? { id: "33333333-3333-4333-8333-333333333333", user_id: runUserId, outcome: "success" } : null; },
        async run() { return { meta: { changes: 1 } }; },
      };
    },
  };
  return { env: { ENVIRONMENT: "local", AUTH_REQUIRED: "false", QUERYMIND_APP: database } as unknown as Env, calls };
}

test.describe("query feedback", () => {
  test("accepts authenticated owner feedback and writes an idempotent upsert plus audit", async () => {
    const { env, calls } = feedbackEnv();
    const response = await submitQueryFeedback(new Request("https://querymind.example/api/v1/query-runs/33333333-3333-4333-8333-333333333333/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: "negative", category: "calculation", comment: "請補充計算方式" }) }), env);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, rating: "negative", category: "calculation" });
    expect(calls.some((sql) => sql.includes("ON CONFLICT(query_run_id, user_id)"))).toBe(true);
    expect(calls.some((sql) => sql.includes("INSERT INTO audit_events"))).toBe(true);
  });

  test("does not reveal or mutate another user's query run", async () => {
    const { env } = feedbackEnv("other-user");
    await expect(submitQueryFeedback(new Request("https://querymind.example/api/v1/query-runs/33333333-3333-4333-8333-333333333333/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ rating: "positive" }) }), env)).rejects.toMatchObject({ status: 404, code: "QUERY_RUN_NOT_FOUND" });
  });
});
