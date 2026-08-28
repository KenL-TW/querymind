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

  test("derives dimensions only from validated GROUP BY expressions", () => {
    const envelope = buildQueryExplainability({
      prompt: "請依商品列出銷售額",
      sql: "SELECT p.name AS product_name, SUM(oi.subtotal) AS sales_revenue FROM products p JOIN order_items oi ON oi.product_id = p.id WHERE oi.status = 'active' GROUP BY p.id, p.name ORDER BY sales_revenue DESC",
      scope,
      referencedTables: ["products", "order_items"],
      rowCount: 2,
      truncated: false,
      maskedColumns: [],
      queryRunId: "44444444-4444-4444-8444-444444444444",
      rawSqlAvailable: true,
    });
    expect(envelope.understanding.metrics).toEqual(["sales amount"]);
    expect(envelope.understanding.dimensions).toEqual(["product"]);
    expect(envelope.understanding.dimensions).not.toContain("grouped dimensions");
    expect(envelope.understanding.dimensions).not.toContain("status");
    expect(envelope.understanding.filters).toEqual([]);
    expect(envelope.explanation.sql).toContain("SELECT p.name");
  });

  test("keeps qualified dimensions after unaliased JOIN relations", () => {
    const envelope = buildQueryExplainability({
      prompt: "請列出銷售額最高的 5 個商品",
      sql: "SELECT products.name, SUM(order_items.subtotal) AS total_revenue FROM order_items JOIN products ON products.id = order_items.product_id JOIN orders ON orders.id = order_items.order_id WHERE orders.status = 'completed' GROUP BY products.name ORDER BY total_revenue DESC LIMIT 5",
      scope,
      referencedTables: ["order_items", "products", "orders"],
      rowCount: 5,
      truncated: false,
      maskedColumns: [],
      queryRunId: "77777777-7777-4777-8777-777777777777",
      rawSqlAvailable: true,
    });
    expect(envelope.understanding.metrics).toEqual(["sales amount"]);
    expect(envelope.understanding.dimensions).toEqual(["product"]);
  });

  test("derives multiple qualified dimensions without inventing one when GROUP BY is absent", () => {
    const grouped = buildQueryExplainability({
      prompt: "依商品與地區彙整銷售額",
      sql: "SELECT products.name, orders.region, SUM(order_items.subtotal) AS total_revenue FROM order_items JOIN products ON products.id = order_items.product_id JOIN orders ON orders.id = order_items.order_id GROUP BY products.name, orders.region",
      scope,
      referencedTables: ["order_items", "products", "orders"],
      rowCount: 5,
      truncated: false,
      maskedColumns: [],
      queryRunId: "88888888-8888-4888-8888-888888888888",
      rawSqlAvailable: true,
    });
    const aggregateOnly = buildQueryExplainability({
      prompt: "總銷售額",
      sql: "SELECT SUM(order_items.subtotal) AS total_revenue FROM order_items JOIN orders ON orders.id = order_items.order_id",
      scope,
      referencedTables: ["order_items", "orders"],
      rowCount: 1,
      truncated: false,
      maskedColumns: [],
      queryRunId: "99999999-9999-4999-8999-999999999999",
      rawSqlAvailable: true,
    });
    expect(grouped.understanding.dimensions).toEqual(["product", "location"]);
    expect(aggregateOnly.understanding.dimensions).toEqual([]);
  });

  test("does not turn WHERE-only business columns into dimensions or generic filters", () => {
    const envelope = buildQueryExplainability({
      prompt: "請列出處理中的客服案件",
      sql: "SELECT id, status FROM support_tickets WHERE status = 'in_progress'",
      scope,
      referencedTables: ["support_tickets"],
      rowCount: 1,
      truncated: false,
      maskedColumns: [],
      queryRunId: "55555555-5555-4555-8555-555555555555",
      rawSqlAvailable: false,
    });
    expect(envelope.understanding.dimensions).toEqual([]);
    expect(envelope.understanding.filters).toEqual(["處理中的案件"]);
    expect(envelope.understanding.filters).not.toContain("query filters applied");
    expect(envelope.explanation).not.toHaveProperty("sql");
  });

  test("omits an empty raw SQL section and keeps governance facts separate", () => {
    const envelope = buildQueryExplainability({ prompt: "查詢資料", sql: "   ", scope, referencedTables: ["orders"], rowCount: 0, truncated: false, maskedColumns: [], queryRunId: "66666666-6666-4666-8666-666666666666", rawSqlAvailable: true });
    expect(envelope.explanation.rawSqlAvailable).toBe(false);
    expect(envelope.explanation).not.toHaveProperty("sql");
    expect(envelope.explanation.business).not.toContain("scope:tw");
    expect(envelope.explanation.business).not.toContain("shipping_city = 'Taipei'");
  });
});

function feedbackEnv(runUserId = "local-anonymous", explainabilityJson: string | null = null, outcome = "success") {
  const calls: string[] = [];
  const database = {
    prepare(sql: string) {
      calls.push(sql);
      return {
        bind(...values: unknown[]) { (this as { values?: unknown[] }).values = values; return this; },
        values: [] as unknown[],
        async first() { return sql.includes("SELECT id, user_id, outcome") ? { id: "33333333-3333-4333-8333-333333333333", user_id: runUserId, outcome, explainability_json: explainabilityJson } : null; },
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

  test("accepts P1.2 evidence-linked correction without provider or business-data execution", async () => {
    const explainability = JSON.stringify({
      version: "p1", queryRunId: "33333333-3333-4333-8333-333333333333",
      understanding: { intent: "比較與彙總資料", metrics: ["sales amount"], dimensions: ["product"], filters: [], timeRange: null, ranking: null, assumptions: [], confidence: "high" },
      sources: { tables: [{ name: "products", label: "Products" }], governance: { scopeApplied: true, rowPolicyApplied: false, columnPolicyApplied: true, dlpApplied: true }, result: { rowCount: 1, truncated: false } },
      explanation: { business: "指標：sales amount", rawSqlAvailable: false }, summary: { headline: "查詢完成", highlights: [], caveats: [] }, feedback: { supported: true, queryRunId: "33333333-3333-4333-8333-333333333333" },
    });
    const { env, calls } = feedbackEnv("local-anonymous", explainability);
    const response = await submitQueryFeedback(new Request("https://querymind.example/api/v1/query-runs/33333333-3333-4333-8333-333333333333/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "p1.2", rating: "NEEDS_ADJUSTMENT", target: { type: "METRIC", ref: "sales amount" }, category: "metric", correction: "<script>alert(1)</script>" }) }), env);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ feedback: { version: "p1.2", rating: "NEEDS_ADJUSTMENT", target: { type: "METRIC", ref: "sales amount" }, category: "metric" } });
    expect(calls.some((sql) => sql.includes("correction_text"))).toBe(true);
    expect(calls.some((sql) => sql.includes("QUERYMIND_DATA") || sql.includes("read_only_sql"))).toBe(false);
  });

  test("accepts the P1.2 positive one-click contract with a whole-answer target", async () => {
    const { env } = feedbackEnv();
    const response = await submitQueryFeedback(new Request("https://querymind.example/api/v1/query-runs/33333333-3333-4333-8333-333333333333/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "p1.2", rating: "POSITIVE" }) }), env);
    await expect(response.json()).resolves.toMatchObject({ feedback: { version: "p1.2", rating: "POSITIVE", target: { type: "WHOLE_ANSWER", ref: null } } });
  });

  test("rejects an invented evidence reference and failed runs without mutation", async () => {
    const explainability = JSON.stringify({ version: "p1", understanding: { intent: "查詢", metrics: ["sales amount"], dimensions: [], filters: [] }, sources: { tables: [] }, explanation: { business: "計算", rawSqlAvailable: false }, summary: { headline: "完成" } });
    const invalid = feedbackEnv("local-anonymous", explainability);
    await expect(submitQueryFeedback(new Request("https://querymind.example/api/v1/query-runs/33333333-3333-4333-8333-333333333333/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "p1.2", rating: "NEEDS_ADJUSTMENT", target: { type: "METRIC", ref: "employees.salary" }, correction: "不應該存在" }) }), invalid.env)).rejects.toMatchObject({ status: 400, code: "INVALID_FEEDBACK_TARGET" });
    const failed = feedbackEnv("local-anonymous", explainability, "failed");
    await expect(submitQueryFeedback(new Request("https://querymind.example/api/v1/query-runs/33333333-3333-4333-8333-333333333333/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ version: "p1.2", rating: "POSITIVE" }) }), failed.env)).rejects.toMatchObject({ status: 404, code: "QUERY_RUN_NOT_FOUND" });
  });
});
