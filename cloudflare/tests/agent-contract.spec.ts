import { expect, test } from "playwright/test";
import { diagnoseQueryIntent, explicitGroupingTarget, gateQueryIntent, numericGroundingSummary, reconstructConversationHistory, verifyNumericGrounding, type QueryIntent } from "../src/lib/agent-contract";
import { authorizedCatalogContext, authorizedSchemaCatalog } from "../src/lib/schema-catalog";
import { executeAfterQueryPolicy, authorizeReadOnlySql } from "../src/lib/query-policy";
import type { EffectiveScope } from "../src/lib/scope";
import { publicMessageMetadata } from "../src/lib/sessions";
import { buildAgentProviderRequest } from "../src/routes/agent";

const ambiguousCases = ["哪些商品表現最好？", "哪個客戶最重要？", "哪個類別最好？"];

const viewerScope: EffectiveScope = {
  userId: "viewer",
  roleId: "viewer",
  roleName: "viewer",
  scopeKey: "role:viewer",
  policyVersion: "test",
  capabilities: ["chat"],
  datasource: { id: "querymind-data", tables: {
    employees: { columns: ["id", "name", "dept_id", "title", "hire_date", "is_active"], canViewRaw: false, canExport: false, canBulkExport: false },
  } },
  canQuery: true,
  canViewRawData: false,
  canExport: false,
  canBulkExport: false,
};

const rawCatalog = { tables: { employees: { tableName: "employees", columns: ["id", "name", "dept_id", "title", "hire_date", "is_active", "salary"] } } };

function intent(input: Partial<QueryIntent> & Pick<QueryIntent, "decision">): QueryIntent {
  return { queryType: null, metric: null, metricEvidence: null, target: null, targetEvidence: null, ...input };
}

test.describe("agent stage ProviderRequest temperature", () => {
  const signal = new AbortController().signal;

  test("uses deterministic intent sampling and preserves SQL/final sampling", () => {
    const messages = [{ role: "user" as const, content: "請依商品列出銷售額" }];
    const intentRequest = buildAgentProviderRequest({
      model: "@cf/zai-org/glm-4.7-flash",
      messages,
      tools: [{ name: "resolve_analytics_intent", description: "resolve intent", parameters: { type: "object" } }],
      toolChoice: "required",
      signal,
    }, "intent");
    expect(intentRequest).toMatchObject({
      temperature: 0,
      maxOutputTokens: 800,
      toolChoice: "required",
      tools: [{ name: "resolve_analytics_intent" }],
    });

    const sqlRequest = buildAgentProviderRequest({
      model: "@cf/zai-org/glm-4.7-flash",
      messages,
      tools: [{ name: "run_readonly_sql", description: "run governed SQL", parameters: { type: "object" } }],
      toolChoice: "required",
      signal,
    }, "sql");
    expect(sqlRequest).toMatchObject({ temperature: 0.1, maxOutputTokens: 800, toolChoice: "required", tools: [{ name: "run_readonly_sql" }] });

    const finalRequest = buildAgentProviderRequest({
      model: "@cf/zai-org/glm-4.7-flash",
      messages,
      signal,
    }, "final");
    expect(finalRequest).toMatchObject({ temperature: 0.1, maxOutputTokens: 800 });
    expect(finalRequest.tools).toBeUndefined();
    expect(finalRequest.toolChoice).toBeUndefined();
  });
});

test.describe("PX-AI-01B1 governed intent gate", () => {
  test("extracts only bounded explicit grouping phrases from the current user turn", () => {
    expect(explicitGroupingTarget("請依商品列出銷售額")).toBe("商品");
    expect(explicitGroupingTarget("按客戶城市列出銷售額")).toBe("客戶城市");
    expect(explicitGroupingTarget("按照產品列出銷售額")).toBe("產品");
    expect(explicitGroupingTarget("以客戶城市分組整理銷售額")).toBe("客戶城市");
    expect(explicitGroupingTarget("總銷售額是多少？")).toBeNull();
  });

  test("accepts a fully evidenced explicit product grouping", () => {
    const proposed = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額", target: "商品", targetEvidence: "商品" });
    expect(gateQueryIntent(proposed, ["請依商品列出銷售額"], []).kind).toBe("QUERY");
  });

  test("fails closed when an explicit grouping is missing from analytical intent", () => {
    const proposed = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額" });
    const diagnostic = diagnoseQueryIntent(proposed, ["請依商品列出銷售額"], []);
    expect(diagnostic).toMatchObject({ explicitGroupingTarget: "商品", validationOutcome: "CLARIFY", validationFailureReason: "MISSING_GROUPING_TARGET" });
    expect(gateQueryIntent(proposed, ["請依商品列出銷售額"], []).kind).toBe("CLARIFY");
  });

  test("rejects a provider target that conflicts with the current explicit grouping", () => {
    const proposed = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額", target: "商品", targetEvidence: "商品" });
    const diagnostic = diagnoseQueryIntent(proposed, ["請依客戶城市列出銷售額"], []);
    expect(diagnostic).toMatchObject({ explicitGroupingTarget: "客戶城市", validationOutcome: "CLARIFY", validationFailureReason: "EXPLICIT_GROUPING_TARGET_MISMATCH" });
  });

  test("accepts a fully evidenced customer-city grouping", () => {
    const proposed = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額", target: "客戶城市", targetEvidence: "客戶城市" });
    expect(gateQueryIntent(proposed, ["請依客戶城市列出銷售額"], []).kind).toBe("QUERY");
  });

  test("does not let date and member filters erase an explicit grouping", () => {
    const prompt = "請依商品列出 2025-04-03 當天的銷售額，只看「QueryBook Air」";
    const missingTarget = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額" });
    expect(diagnoseQueryIntent(missingTarget, [prompt], []).validationFailureReason).toBe("MISSING_GROUPING_TARGET");
    const grouped = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額", target: "商品", targetEvidence: "商品" });
    expect(gateQueryIntent(grouped, [prompt], []).kind).toBe("QUERY");
  });

  test("keeps explicitly grounded scalar analytics valid without a target", () => {
    const proposed = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額" });
    expect(gateQueryIntent(proposed, ["總銷售額是多少？"], []).kind).toBe("QUERY");
  });

  test("keeps C05 ambiguous despite a product noun", () => {
    const proposed = intent({ decision: "CLARIFY" });
    expect(gateQueryIntent(proposed, ["哪些商品表現最好？"], []).kind).toBe("CLARIFY");
  });

  for (const prompt of ambiguousCases) {
    test(`ambiguous analytical request does not enter SQL stage: ${prompt}`, () => {
      const proposed = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: prompt, target: "商品", targetEvidence: "商品" });
      const decision = gateQueryIntent(proposed, [prompt], []);
      let queryExecutions = 0;
      if (decision.kind === "QUERY") queryExecutions += 1;
      expect(decision.kind).toBe("CLARIFY");
      expect(queryExecutions).toBe(0);
    });
  }

  test("explicit metric evidence resolves while preserving follow-up evidence from the prior user turn", () => {
    const firstTurn = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額", target: "商品", targetEvidence: "商品" });
    expect(gateQueryIntent(firstTurn, ["請依商品列出銷售額"], []).kind).toBe("QUERY");
    const quantityTurn = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售量", metricEvidence: "銷售量", target: "商品", targetEvidence: "商品" });
    expect(gateQueryIntent(quantityTurn, ["銷售量最高的商品"], []).kind).toBe("QUERY");
    const followUp = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額", target: "商品", targetEvidence: "商品" });
    expect(gateQueryIntent(followUp, ["請依商品列出銷售額", "那只看最高的兩個"], [])).toMatchObject({
      kind: "QUERY",
      intent: { decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", target: "商品" },
    });
  });

  test("approved reference evidence can resolve a measure, but unsupported inferred evidence cannot", () => {
    const semanticMetric = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "gross revenue", metricEvidence: "gross revenue" });
    expect(gateQueryIntent(semanticMetric, ["列出結果"], ["gross revenue: SUM(order_items.subtotal)"]).kind).toBe("QUERY");
    const inventedMetric = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "表現最好" });
    expect(gateQueryIntent(inventedMetric, ["哪些商品表現最好？"], []).kind).toBe("CLARIFY");
  });

  test("provider-canonicalized metric is rejected with an explicit bounded diagnostic", () => {
    const canonical = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "sales amount", metricEvidence: "銷售額", target: "product", targetEvidence: "商品" });
    const diagnostic = diagnoseQueryIntent(canonical, ["請依商品列出銷售額"], []);
    expect(diagnostic).toMatchObject({
      metricEvidencePresentInUserSources: true,
      targetEvidencePresentInUserSources: true,
      validationOutcome: "CLARIFY",
      validationFailureReason: "METRIC_EVIDENCE_CONTRACT_MISMATCH",
    });
    expect(gateQueryIntent(canonical, ["請依商品列出銷售額"], []).kind).toBe("CLARIFY");
  });

  test("vague evaluative evidence cannot be paired with an invented measure", () => {
    const invented = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "sales amount", metricEvidence: "表現最好", target: "product", targetEvidence: "商品" });
    const diagnostic = diagnoseQueryIntent(invented, ["哪些商品表現最好？"], []);
    expect(diagnostic).toMatchObject({
      metricEvidencePresentInUserSources: true,
      validationOutcome: "CLARIFY",
      validationFailureReason: "METRIC_EVIDENCE_CONTRACT_MISMATCH",
    });
    expect(gateQueryIntent(invented, ["哪些商品表現最好？"], []).kind).toBe("CLARIFY");
  });

  test("metric evidence absent from current, prior and approved reference sources remains a clarification", () => {
    const absent = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額" });
    const diagnostic = diagnoseQueryIntent(absent, ["列出商品"], ["gross revenue: approved formula"]);
    expect(diagnostic.validationOutcome).toBe("CLARIFY");
    expect(diagnostic.validationFailureReason).toBe("METRIC_EVIDENCE_NOT_FOUND");
  });
});

test.describe("PX-AI-01B1 C06 deterministic policy evidence", () => {
  test("authorized catalog includes employees but excludes salary", async () => {
    const database = {
      prepare(sql: string) {
        return {
          bind() { return this; },
          async first() { return sql.includes("schema_catalog_state") ? { schema_snapshot_id: "snapshot-fixture" } : null; },
          async all() {
            if (sql.includes("schema_catalog_tables")) return { results: [{ table_name: "employees", description: "Employees" }] };
            if (sql.includes("schema_catalog_columns")) return { results: ["id", "name", "dept_id", "title", "hire_date", "is_active", "salary"].map((column_name) => ({ table_name: "employees", column_name, data_type: "TEXT", is_not_null: 0, is_primary_key: 0, description: "" })) };
            if (sql.includes("schema_catalog_foreign_keys")) return { results: [] };
            throw new Error("Unexpected catalog statement");
          },
        };
      },
    };
    const catalog = await authorizedSchemaCatalog({ QUERYMIND_APP: database } as unknown as Env, viewerScope);
    expect(catalog.tables.map((table) => table.name)).toContain("employees");
    expect(catalog.tables[0].columns.map((column) => column.name)).not.toContain("salary");
    expect(authorizedCatalogContext(catalog)).not.toMatch(/salary/iu);
  });

  test("explicit unauthorized salary projection is denied before DLP and data execution", async () => {
    let dlpCalls = 0;
    let dataExecutions = 0;
    let resultPayload: unknown = undefined;
    await expect(executeAfterQueryPolicy(
      async () => authorizeReadOnlySql("SELECT salary FROM employees", 100, viewerScope, rawCatalog),
      async () => { dlpCalls += 1; },
      async () => { dataExecutions += 1; resultPayload = [{ salary: 120_000 }]; return resultPayload; },
    )).rejects.toMatchObject({ code: "COLUMN_NOT_ALLOWED" });
    expect(dlpCalls).toBe(0);
    expect(dataExecutions).toBe(0);
    expect(resultPayload).toBeUndefined();
  });
});

test.describe("PX-AI-01B1 multi-turn history reconstruction", () => {
  test("replays user intent, assistant tool call, matching tool result IDs, and final answer", () => {
    const storedIntent = intent({ decision: "QUERY", queryType: "ANALYTICAL", metric: "銷售額", metricEvidence: "銷售額", target: "商品", targetEvidence: "商品" });
    const history = reconstructConversationHistory([
      { role: "user", content: "請依商品列出銷售額" },
      { role: "assistant", content: "查詢完成，共取得 1 筆資料。", metadata_json: JSON.stringify({ rowCount: 1, rows: [{ product_name: "A", sales_amount: 13160 }], agentContext: { version: 1, intentCallId: "intent-call-1", intent: storedIntent, queryCallId: "sql-call-1", queryRunId: "query-run-1" } }) },
    ], [{ id: "query-run-1", generated_sql: "SELECT name, SUM(subtotal) AS sales_amount FROM order_items GROUP BY name" }]);

    expect(history.map((message) => message.role)).toEqual(["user", "assistant", "tool", "assistant", "tool", "assistant"]);
    expect(history[1]).toMatchObject({ role: "assistant", toolCalls: [{ id: "intent-call-1", name: "resolve_analytics_intent" }] });
    expect(history[2]).toMatchObject({ role: "tool", toolCallId: "intent-call-1" });
    expect(history[3]).toMatchObject({ role: "assistant", toolCalls: [{ id: "sql-call-1", name: "run_readonly_sql", arguments: expect.stringContaining("SELECT name") }] });
    expect(history[4]).toMatchObject({ role: "tool", toolCallId: "sql-call-1", content: expect.stringContaining("13160") });
    expect(history[5]).toMatchObject({ role: "assistant", content: "查詢完成，共取得 1 筆資料。" });
  });

  test("does not synthesize a historic SQL call when the governed query row is missing", () => {
    const history = reconstructConversationHistory([
      { role: "user", content: "請依商品列出銷售額" },
      { role: "assistant", content: "Clarification", metadata_json: JSON.stringify({ agentContext: { version: 1, intentCallId: "intent-call-2", intent: intent({ decision: "CLARIFY" }), queryCallId: "sql-call-2", queryRunId: "missing" } }) },
    ], []);
    expect(history.some((message) => message.role === "assistant" && message.toolCalls?.some((call) => call.name === "run_readonly_sql"))).toBe(false);
    expect(history.some((message) => message.role === "tool" && message.toolCallId === "intent-call-2")).toBe(true);
  });

  test("public session history omits private agent tool state while retaining product metadata", () => {
    const value = JSON.parse(publicMessageMetadata(JSON.stringify({ queryRunId: "run-1", rows: [{ amount: 1 }], agentContext: { queryCallId: "private-call-id" } }))) as Record<string, unknown>;
    expect(value).toMatchObject({ queryRunId: "run-1", rows: [{ amount: 1 }] });
    expect(value).not.toHaveProperty("agentContext");
  });
});

test.describe("PX-AI-01B1 in-memory numeric grounding", () => {
  const observation = { rowCount: 2, rows: [{ product: "Product A", amount: 13160 }, { product: "Product B", amount: 10000 }] };

  for (const answer of ["13,160", "13,160元", "NT$13,160", "1. Product A：13,160"]) {
    test(`accepts grounded amount and formatting: ${answer}`, () => {
      const summary = numericGroundingSummary(verifyNumericGrounding(answer, observation));
      expect(summary.unsupportedCount).toBe(0);
      expect(summary.claimCount).toBe(answer.startsWith("1.") ? 2 : 1);
    });
  }

  test("accepts an evidenced total and percentage derivable from an observed numeric column", () => {
    expect(numericGroundingSummary(verifyNumericGrounding("合計：23,160；最大商品占比 56.8%", observation)).unsupportedCount).toBe(0);
    expect(numericGroundingSummary(verifyNumericGrounding("共2筆資料", observation)).unsupportedCount).toBe(0);
  });

  test("does not accept a row count as an unrelated business value or derive totals from identifiers", () => {
    const countOnly = numericGroundingSummary(verifyNumericGrounding("amount: 2", { rowCount: 2, rows: [{ amount: 5 }, { amount: 9 }] }));
    expect(countOnly.unsupportedCount).toBe(1);
    const identifiers = numericGroundingSummary(verifyNumericGrounding("合計：3", { rowCount: 2, rows: [{ product_id: 1 }, { product_id: 2 }] }));
    expect(identifiers.unsupportedCount).toBe(1);
  });

  test("classifies list ordinal and date/time separately from business values", () => {
    const summary = numericGroundingSummary(verifyNumericGrounding("1. Product A — 13,160\n更新時間：2026-10-15 09:30", observation));
    expect(summary.categories["ORDINAL / LIST INDEX"]).toBe(1);
    expect(summary.categories["DATE/TIME"]).toBe(5);
    expect(summary.unsupportedCount).toBe(0);
  });

  test("rejects a factual amount absent from and not derivable from the observation", () => {
    const claims = verifyNumericGrounding("Product A amount: 999", observation);
    expect(numericGroundingSummary(claims).unsupportedCount).toBe(1);
    expect(claims[0]).toMatchObject({ category: "UNSUPPORTED", grounded: false });
  });
});
