import type { EffectiveScope } from "./scope";

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

function queryUnderstanding(prompt: string | null, sql: string): QueryUnderstanding {
  const text = `${prompt ?? ""} ${sql}`.toLowerCase();
  const metrics: string[] = [];
  if (/count\s*\(/u.test(text) || /多少|幾筆|數量|筆數|count/u.test(text)) metrics.push("count");
  if (/sum\s*\(/u.test(text) || /營收|銷售額|sales|revenue|金額/u.test(text)) metrics.push("sales amount");
  if (/avg\s*\(|average|平均/u.test(text)) metrics.push("average");
  if (/max\s*\(|最高|最多|top|最大/u.test(text)) metrics.push("maximum");
  if (/min\s*\(|最低|最少|minimum/u.test(text)) metrics.push("minimum");
  const dimensions = distinct([
    /group\s+by\s+[^,]+/u.test(text) ? "grouped dimensions" : "",
    /product|商品/u.test(text) ? "product" : "",
    /customer|客戶/u.test(text) ? "customer" : "",
    /city|城市|地區/u.test(text) ? "location" : "",
    /department|部門/u.test(text) ? "department" : "",
    /status|狀態/u.test(text) ? "status" : "",
  ]);
  const filters = distinct([
    /where\b/u.test(text) ? "query filters applied" : "",
    /cancelled|取消/u.test(text) ? "cancelled records excluded" : "",
    /active|啟用/u.test(text) ? "active records" : "",
  ]);
  const timeRange = /(?:last|past|最近|近)[^\n]{0,30}(?:day|week|month|quarter|year|天|週|月|季|年)/u.exec(text)?.[0] ?? null;
  const ranking = /order\s+by[^\n]{0,80}(?:desc|asc)|top\s+\d+|排行|排名/u.test(text) ? "ordered or ranked results" : null;
  const intent = metrics.length ? (dimensions.length ? "比較與彙總資料" : "彙總資料") : "檢視符合條件的資料";
  const assumptions = distinct([
    /cancelled|取消/u.test(text) ? "取消訂單不納入分析" : "",
    /group\s+by/u.test(text) ? "依查詢指定的維度分組" : "",
    "只呈現目前資料權限允許的結果",
  ], 3);
  return { intent, metrics: metrics.length ? metrics : ["結果筆數"], dimensions, filters, timeRange: timeRange ? compact(timeRange, 80) : null, ranking, assumptions, confidence: prompt ? "high" : "medium" };
}

export function buildQueryExplainability(input: BuildInput): QueryExplainability {
  const tables = distinct(input.referencedTables.map((table) => table.toLowerCase()), 8).map((name) => ({ name, label: label(name) }));
  const rowPolicyApplied = tables.some(({ name }) => Boolean(input.scope.datasource.tables[name]?.rowFilter));
  const masked = distinct(input.maskedColumns.map((column) => column.replaceAll("_", " ")), 4);
  const understanding = queryUnderstanding(input.prompt, input.sql);
  const tableText = tables.map((table) => table.label).join("、") || "授權資料來源";
  const business = `本次查詢使用 ${tableText}，依提出的問題完成唯讀資料整理，共產生 ${input.rowCount} 筆結果。結果已套用目前帳戶的資料範圍、欄位權限與敏感資料遮罩。`;
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
  return {
    version: "p1",
    queryRunId: input.queryRunId,
    understanding,
    sources: {
      tables,
      governance: { scopeApplied: true, rowPolicyApplied, columnPolicyApplied: true, dlpApplied: true },
      result: { rowCount: input.rowCount, truncated: input.truncated },
    },
    explanation: { business, rawSqlAvailable: input.rawSqlAvailable, ...(input.rawSqlAvailable ? { sql: input.sql } : {}) },
    summary: { headline: `查詢完成，共 ${input.rowCount} 筆結果`, highlights, caveats },
    feedback: { supported: true, queryRunId: input.queryRunId },
  };
}
