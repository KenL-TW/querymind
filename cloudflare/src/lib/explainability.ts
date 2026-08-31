import type { EffectiveScope } from "./scope";
import type { ResolvedSemanticContext, SelectedSemanticProvenance } from "./approved-semantic-context";

export const SEMANTIC_EVIDENCE_LIMITS = { selections: 8, sourcesPerSelection: 8, relationshipRefs: 4, serializedBytes: 8_000 } as const;

export interface SemanticEvidenceSelection {
  assetId: string;
  revisionId: string;
  semanticType: "TERM" | "DIMENSION" | "METRIC" | "RELATIONSHIP";
  canonicalName: string;
  label: string;
  domain: string;
  grain?: string;
  metricAstSummary?: string;
  sources: Array<{ table: string; column?: string }>;
  relationshipRefs?: string[];
  definition?: string;
}

export interface SemanticEvidence {
  mode: "USED" | "NOT_USED";
  registryVersion: number | null;
  schemaSnapshotId: string | null;
  selections: SemanticEvidenceSelection[];
}

export interface QueryUnderstanding {
  intent: string;
  metrics: string[];
  dimensions: string[];
  filters: string[];
  timeRange: string | null;
  ranking: string | null;
  assumptions: string[];
  confidence: "high" | "medium" | "low";
}

export interface QuerySourceTrace {
  tables: Array<{ name: string; label: string }>;
  governance: {
    scopeApplied: boolean;
    rowPolicyApplied: boolean;
    columnPolicyApplied: boolean;
    dlpApplied: boolean;
  };
  result: { rowCount: number; truncated: boolean };
}

export interface QueryResultSummary {
  headline: string;
  highlights: string[];
  caveats: string[];
}

export interface QueryExplainability {
  version: "p1";
  queryRunId: string;
  understanding: QueryUnderstanding;
  sources: QuerySourceTrace;
  explanation: {
    business: string;
    rawSqlAvailable: boolean;
    sql?: string;
  };
  summary: QueryResultSummary;
  feedback: { supported: true; queryRunId: string };
  /** P2-G output provenance. Missing means the QueryRun predates this release. */
  semanticEvidence?: SemanticEvidence;
}

interface BuildInput {
  prompt: string | null;
  sql: string;
  scope: EffectiveScope;
  referencedTables: string[];
  rowCount: number;
  truncated: boolean;
  maskedColumns: string[];
  queryRunId: string;
  rawSqlAvailable: boolean;
  semanticContext?: ResolvedSemanticContext | null;
  semanticEvidenceMode?: "NOT_USED";
}

function compactText(value: string, max: number): string { return value.replace(/\s+/gu, " ").trim().slice(0, max); }

function selectionSnapshot(selection: SelectedSemanticProvenance): SemanticEvidenceSelection {
  return {
    assetId: selection.assetId,
    revisionId: selection.revisionId,
    semanticType: selection.assetType,
    canonicalName: compactText(selection.canonicalName, 160),
    label: compactText(selection.label, 160),
    domain: compactText(selection.domain, 120),
    sources: selection.sources.slice(0, SEMANTIC_EVIDENCE_LIMITS.sourcesPerSelection).map((source) => ({ table: compactText(source.table, 120), ...(source.column ? { column: compactText(source.column, 120) } : {}) })),
    ...(selection.grain ? { grain: compactText(selection.grain, 120) } : {}),
    ...(selection.metricAstSummary ? { metricAstSummary: compactText(selection.metricAstSummary, 500) } : {}),
    ...(selection.relationshipRefs ? { relationshipRefs: selection.relationshipRefs.slice(0, SEMANTIC_EVIDENCE_LIMITS.relationshipRefs).map((item) => compactText(item, 240)) } : {}),
    ...(selection.definition ? { definition: compactText(selection.definition, 280) } : {}),
  };
}

/** Semantic Evidence is observational, not authoritative. */
export function semanticEvidenceForRun(context: ResolvedSemanticContext | null | undefined, forcedMode?: "NOT_USED"): SemanticEvidence {
  if (forcedMode === "NOT_USED" || context?.status !== "READY" || context.selected.length === 0) return { mode: "NOT_USED", registryVersion: null, schemaSnapshotId: null, selections: [] };
  const evidence: SemanticEvidence = { mode: "USED", registryVersion: context.registryVersion, schemaSnapshotId: context.schemaSnapshotId, selections: context.selected.slice(0, SEMANTIC_EVIDENCE_LIMITS.selections).map(selectionSnapshot) };
  if (new TextEncoder().encode(JSON.stringify(evidence)).byteLength > SEMANTIC_EVIDENCE_LIMITS.serializedBytes) {
    throw new Error("semantic evidence exceeds bounded storage contract");
  }
  return evidence;
}

const LABELS: Record<string, string> = {
  orders: "Orders",
  order_items: "Order Items",
  products: "Products",
  customers: "Customers",
  customer_addresses: "Customer Addresses",
  departments: "Departments",
  employees: "Employees",
  categories: "Categories",
  suppliers: "Suppliers",
  promotions: "Promotions",
  inventory_transactions: "Inventory Transactions",
  product_reviews: "Product Reviews",
  sales_targets: "Sales Targets",
  support_tickets: "Support Tickets",
};

const COLUMN_LABELS: Record<string, string> = {
  subtotal: "sales amount",
  total: "order value",
  quantity: "quantity",
  count: "count",
  price: "price",
  rating: "rating",
  target_amt: "target amount",
};

function compact(value: string, max: number): string {
  return value.replace(/\s+/gu, " ").trim().slice(0, max);
}

function label(table: string): string { return LABELS[table] ?? table.replaceAll("_", " ").replace(/\b\w/gu, (match) => match.toUpperCase()); }

function distinct(values: string[], max = 6): string[] { return [...new Set(values.filter(Boolean))].slice(0, max); }

function splitTopLevel(value: string): string[] {
  const parts: string[] = [];
  let start = 0;
  let depth = 0;
  let quote = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (character === quote && value[index - 1] !== "\\") quote = "";
      continue;
    }
    if (character === "'" || character === '"' || character === "`") quote = character;
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function aliasesFromSql(sql: string): Map<string, string> {
  const aliases = new Map<string, string>();
  // Do not consume a following JOIN (or clause keyword) as an implicit alias.
  // This is deliberately a bounded display-only helper: authorization continues
  // to rely exclusively on QueryPolicyEngine's governed SQL parser.
  const relationPattern = /\b(?:from|join)\s+([a-z0-9_"`.[\]-]+)(?:(?:\s+as\s+)([a-z_][a-z0-9_]*)|(?:\s+(?!on\b|where\b|group\b|order\b|having\b|limit\b|offset\b|union\b|intersect\b|except\b|window\b|inner\b|left\b|right\b|full\b|cross\b|join\b)([a-z_][a-z0-9_]*)))?/giu;
  for (const match of sql.matchAll(relationPattern)) {
    const table = (match[1] ?? "").replace(/["`[\]]/gu, "").split(".").pop()?.toLowerCase();
    const alias = (match[2] ?? match[3])?.toLowerCase();
    if (!table) continue;
    aliases.set(table, table);
    if (alias && !/^(?:on|where|group|order|having|limit|offset|inner|left|right|full|cross|join)$/u.test(alias)) aliases.set(alias, table);
  }
  return aliases;
}

function dimensionForExpression(expression: string, aliases: Map<string, string>): string | null {
  const cleaned = expression.replace(/\s+(?:asc|desc)\b(?:\s+nulls\s+(?:first|last))?$/iu, "").replace(/["`[\]]/gu, "").trim();
  if (!cleaned || /\b(?:case|cast|date|strftime|coalesce)\b/iu.test(cleaned)) return null;
  const qualified = /^(?:([a-z0-9_]+)\.)?([a-z0-9_]+)$/iu.exec(cleaned);
  if (!qualified) return null;
  const relation = qualified[1]?.toLowerCase();
  const column = qualified[2].toLowerCase();
  const table = relation ? aliases.get(relation) : undefined;
  if (column === "shipping_city" || column === "city" || column === "region") return "location";
  if (column === "status" || column === "state") return "status";
  if (column === "category" || column === "category_id") return "category";
  if (column === "supplier_id" || column === "supplier") return "supplier";
  if (column === "department" || column === "department_id" || column === "dept_id") return "department";
  if (column === "customer_id" || column === "customer") return "customer";
  if (column === "product_id" || column === "product") return "product";
  if (column === "name" || column === "product_name") {
    if (table === "products" || table === "product_reviews" || table === "inventory_transactions") return "product";
    if (table === "customers") return "customer";
    if (table === "departments") return "department";
    if (table === "categories") return "category";
    if (table === "suppliers") return "supplier";
  }
  return null;
}

function groupedDimensions(sql: string): string[] {
  const clause = /\bgroup\s+by\b([\s\S]*?)(?=\border\s+by\b|\bhaving\b|\blimit\b|\boffset\b|\bunion\b|$)/iu.exec(sql)?.[1];
  if (!clause) return [];
  const aliases = aliasesFromSql(sql);
  return distinct(splitTopLevel(clause).map((expression) => dimensionForExpression(expression, aliases) ?? ""));
}

function aggregateMetrics(sql: string): string[] {
  const metrics: string[] = [];
  const aggregatePattern = /\b(count|sum|avg|average|max|min)\s*\(\s*([^)]*)\)/giu;
  for (const match of sql.matchAll(aggregatePattern)) {
    const functionName = match[1]?.toLowerCase();
    const argument = (match[2] ?? "").toLowerCase();
    if (functionName === "count") metrics.push("count");
    else if (functionName === "sum" && /(subtotal|total|revenue|sales|amount|price)/u.test(argument)) metrics.push(COLUMN_LABELS.subtotal);
    else if (functionName === "sum" && /quantity|qty/u.test(argument)) metrics.push(COLUMN_LABELS.quantity);
    else if (functionName === "avg" || functionName === "average") metrics.push("average");
    else if (functionName === "max") metrics.push("maximum");
    else if (functionName === "min") metrics.push("minimum");
  }
  return distinct(metrics);
}

function explicitPromptFilters(prompt: string | null): string[] {
  const text = (prompt ?? "").toLowerCase();
  return distinct([
    /cancelled|canceled|未\s*取\s*消|未取消|非取消/u.test(text) ? "未取消訂單" : "",
    /active|啟用|啟用中/u.test(text) ? "啟用資料" : "",
    /處理中|進行中|in\s*progress/u.test(text) ? "處理中的案件" : "",
  ]);
}

function queryUnderstanding(prompt: string | null, sql: string): QueryUnderstanding {
  const text = `${prompt ?? ""} ${sql}`.toLowerCase();
  const metrics = aggregateMetrics(sql);
  const dimensions = groupedDimensions(sql);
  const filters = explicitPromptFilters(prompt);
  const timeRange = /(?:last|past|最近|近)[^\n]{0,30}(?:day|week|month|quarter|year|天|週|月|季|年)/u.exec(text)?.[0] ?? null;
  const ranking = /order\s+by[^\n]{0,80}(?:desc|asc)|top\s+\d+|排行|排名/u.test(text) ? "ordered or ranked results" : null;
  const intent = metrics.length ? (dimensions.length ? "比較與彙總資料" : "彙總資料") : (dimensions.length ? "分組資料" : "資料查詢");
  const assumptions = distinct([
    filters.includes("未取消訂單") ? "取消訂單不納入分析" : "",
    dimensions.length ? "依查詢指定的維度分組" : "",
    "只呈現目前資料權限允許的結果",
  ], 3);
  return { intent, metrics, dimensions, filters, timeRange: timeRange ? compact(timeRange, 80) : null, ranking, assumptions, confidence: prompt && (metrics.length || dimensions.length || filters.length) ? "high" : "medium" };
}

export function buildQueryExplainability(input: BuildInput): QueryExplainability {
  const tables = distinct(input.referencedTables.map((table) => table.toLowerCase()), 8).map((name) => ({ name, label: label(name) }));
  const rowPolicyApplied = tables.some(({ name }) => Boolean(input.scope.datasource.tables[name]?.rowFilter));
  const masked = distinct(input.maskedColumns.map((column) => column.replaceAll("_", " ")), 4);
  const understanding = queryUnderstanding(input.prompt, input.sql);
  const tableText = tables.map((table) => table.label).join("、") || "授權資料來源";
  const businessFacts = distinct([
    `來源：${tableText}`,
    understanding.metrics.length ? `指標：${understanding.metrics.join("、")}` : "",
    understanding.dimensions.length ? `分組：${understanding.dimensions.join("、")}` : "",
    understanding.filters.length ? `條件：${understanding.filters.join("、")}` : "",
  ], 4).join("；");
  const business = `${businessFacts || "本次查詢未辨識出額外的業務計算"}；共產生 ${input.rowCount} 筆結果。`;
  const highlights = distinct([
    `來源：${tableText}`,
    understanding.metrics.length ? `分析指標：${understanding.metrics.join("、")}` : "",
    understanding.dimensions.length ? `整理維度：${understanding.dimensions.join("、")}` : "",
  ], 3);
  const caveats = distinct([
    input.truncated ? "結果已達本次查詢上限，畫面僅呈現部分結果。" : "",
    masked.length ? `部分欄位已遮罩：${masked.join("、")}。` : "",
    rowPolicyApplied ? "資料列範圍已套用治理規則；未顯示規則內容。" : "",
  ], 3);
  const sql = input.sql.trim();
  const rawSqlAvailable = input.rawSqlAvailable && Boolean(sql);
  const semanticEvidence = semanticEvidenceForRun(input.semanticContext, input.semanticEvidenceMode);
  return {
    version: "p1",
    queryRunId: input.queryRunId,
    understanding,
    sources: {
      tables,
      governance: { scopeApplied: true, rowPolicyApplied, columnPolicyApplied: true, dlpApplied: true },
      result: { rowCount: input.rowCount, truncated: input.truncated },
    },
    explanation: { business, rawSqlAvailable, ...(rawSqlAvailable ? { sql } : {}) },
    summary: { headline: `查詢完成，共 ${input.rowCount} 筆結果`, highlights, caveats },
    feedback: { supported: true, queryRunId: input.queryRunId },
    semanticEvidence,
  };
}
