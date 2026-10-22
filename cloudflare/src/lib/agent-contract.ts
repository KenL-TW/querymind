import type { ProviderMessage, ProviderTool, ProviderToolCall } from "./ai-provider";

export type QueryIntent = {
  decision: "QUERY" | "CLARIFY" | "CHAT";
  queryType: "ANALYTICAL" | "LOOKUP" | null;
  metric: string | null;
  metricEvidence: string | null;
  target: string | null;
  targetEvidence: string | null;
};

export type ValidatedQueryIntent = QueryIntent & { decision: "QUERY"; queryType: "ANALYTICAL" | "LOOKUP" };

export const RESOLVE_INTENT_TOOL: ProviderTool = {
  name: "resolve_analytics_intent",
  description: "Classify whether the user made a data request and resolve only explicitly evidenced measures or lookup targets. Ask for clarification when a business measure is ambiguous.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      decision: { type: "string", enum: ["QUERY", "CLARIFY", "CHAT"] },
      queryType: { type: ["string", "null"], enum: ["ANALYTICAL", "LOOKUP", null] },
      metric: { type: ["string", "null"], description: "The exact explicit measure phrase, copied verbatim from user evidence or an approved semantic reference; do not translate or infer it." },
      metricEvidence: { type: ["string", "null"], description: "The same exact short measure phrase copied verbatim from a user message or approved semantic reference." },
      target: { type: ["string", "null"], description: "The exact subject or grouping target requested by the user. For explicit grouping forms such as 依 X 列出 Y, copy exact X." },
      targetEvidence: { type: ["string", "null"], description: "The same exact short user-evidence phrase that names the requested subject or grouping target. For 依 X 列出 Y, copy exact X." },
    },
    required: ["decision", "queryType", "metric", "metricEvidence", "target", "targetEvidence"],
  },
};

export const RUN_SQL_TOOL: ProviderTool = {
  name: "run_readonly_sql",
  description: "Run one read-only SQLite SELECT or WITH query against the QueryMind business database.",
  strict: true,
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: { sql: { type: "string", description: "A single SQLite SELECT or WITH statement without comments or semicolons." } },
    required: ["sql"],
  },
};

function normalizeEvidence(value: string): string {
  return value.normalize("NFKC").toLocaleLowerCase().replace(/\s+/gu, " ").trim();
}

/**
 * Extract only a grouping phrase the user explicitly wrote in the current turn.
 * This is intentionally structural rather than semantic: it does not guess a
 * metric, target, or database mapping.
 */
export function explicitGroupingTarget(currentUserTurn: string): string | null {
  const patterns = [
    /(?:請\s*)?(?:按照|依|按)\s*(?<target>[\p{L}\p{N}_\-\s]{1,120}?)\s*(?:列出|顯示|呈現|查詢|整理)/u,
    /(?:請\s*)?以\s*(?<target>[\p{L}\p{N}_\-\s]{1,120}?)\s*分組/u,
  ];
  for (const pattern of patterns) {
    const target = pattern.exec(currentUserTurn)?.groups?.target?.trim();
    if (target) return target;
  }
  return null;
}

function parseNullableText(value: unknown, maximum: number): string | null {
  if (value === null) return null;
  return typeof value === "string" && value.trim().length > 0 && value.length <= maximum ? value.trim() : null;
}

export function parseQueryIntent(call: ProviderToolCall): QueryIntent | null {
  if (call.name !== RESOLVE_INTENT_TOOL.name || !/^[A-Za-z0-9_-]{1,128}$/u.test(call.id)) return null;
  try {
    const value = JSON.parse(call.arguments) as Record<string, unknown>;
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    if (!(value.decision === "QUERY" || value.decision === "CLARIFY" || value.decision === "CHAT")) return null;
    if (!(value.queryType === "ANALYTICAL" || value.queryType === "LOOKUP" || value.queryType === null)) return null;
    const metric = parseNullableText(value.metric, 120);
    const metricEvidence = parseNullableText(value.metricEvidence, 120);
    const target = parseNullableText(value.target, 120);
    const targetEvidence = parseNullableText(value.targetEvidence, 120);
    if ((value.metric !== null && metric === null) || (value.metricEvidence !== null && metricEvidence === null)
      || (value.target !== null && target === null) || (value.targetEvidence !== null && targetEvidence === null)) return null;
    return { decision: value.decision, queryType: value.queryType, metric, metricEvidence, target, targetEvidence };
  } catch {
    return null;
  }
}

function evidenceIsInSources(evidence: string, sources: string[]): boolean {
  const needle = normalizeEvidence(evidence);
  return Boolean(needle) && sources.some((source) => normalizeEvidence(source).includes(needle));
}

export function validateQueryIntent(
  intent: QueryIntent,
  userEvidence: string[],
  approvedReferenceEvidence: string[],
): ValidatedQueryIntent | null {
  return diagnoseQueryIntent(intent, userEvidence, approvedReferenceEvidence).validationOutcome === "QUERY"
    ? intent as ValidatedQueryIntent
    : null;
}

export type IntentValidationFailureReason =
  | "MISSING_METRIC"
  | "MISSING_METRIC_EVIDENCE"
  | "METRIC_EVIDENCE_CONTRACT_MISMATCH"
  | "METRIC_EVIDENCE_NOT_FOUND"
  | "MISSING_TARGET"
  | "MISSING_GROUPING_TARGET"
  | "MISSING_TARGET_EVIDENCE"
  | "TARGET_EVIDENCE_CONTRACT_MISMATCH"
  | "TARGET_EVIDENCE_NOT_FOUND"
  | "EXPLICIT_GROUPING_TARGET_MISMATCH"
  | "INVALID_INTENT_SHAPE"
  | null;

export interface IntentDiagnostic {
  decision: QueryIntent["decision"] | "INVALID";
  queryType: QueryIntent["queryType"];
  metric: string | null;
  metricEvidence: string | null;
  target: string | null;
  targetEvidence: string | null;
  metricEvidencePresentInUserSources: boolean;
  metricEvidencePresentInApprovedReferences: boolean;
  targetEvidencePresentInUserSources: boolean;
  explicitGroupingTarget: string | null;
  validationOutcome: "QUERY" | "CLARIFY" | "CHAT";
  validationFailureReason: IntentValidationFailureReason;
}

export function diagnoseQueryIntent(
  intent: QueryIntent | null,
  userEvidence: string[],
  approvedReferenceEvidence: string[],
): IntentDiagnostic {
  const currentUserTurn = userEvidence.at(-1) ?? "";
  const groupingTarget = explicitGroupingTarget(currentUserTurn);
  const metricEvidencePresentInUserSources = Boolean(intent?.metricEvidence && evidenceIsInSources(intent.metricEvidence, userEvidence));
  const metricEvidencePresentInApprovedReferences = Boolean(intent?.metricEvidence && evidenceIsInSources(intent.metricEvidence, approvedReferenceEvidence));
  const targetEvidencePresentInUserSources = Boolean(intent?.targetEvidence && evidenceIsInSources(intent.targetEvidence, userEvidence));
  const base = {
    decision: intent?.decision ?? "INVALID" as const,
    queryType: intent?.queryType ?? null,
    metric: intent?.metric ?? null,
    metricEvidence: intent?.metricEvidence ?? null,
    target: intent?.target ?? null,
    targetEvidence: intent?.targetEvidence ?? null,
    metricEvidencePresentInUserSources,
    metricEvidencePresentInApprovedReferences,
    targetEvidencePresentInUserSources,
    explicitGroupingTarget: groupingTarget,
  };
  if (!intent) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "INVALID_INTENT_SHAPE" };
  if (intent.decision === "CHAT") return { ...base, validationOutcome: "CHAT", validationFailureReason: null };
  if (intent.decision === "CLARIFY") return { ...base, validationOutcome: "CLARIFY", validationFailureReason: null };
  if (!intent.queryType) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "INVALID_INTENT_SHAPE" };
  if (intent.queryType === "ANALYTICAL") {
    if (!intent.metric) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "MISSING_METRIC" };
    if (!intent.metricEvidence) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "MISSING_METRIC_EVIDENCE" };
    if (normalizeEvidence(intent.metric) !== normalizeEvidence(intent.metricEvidence)) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "METRIC_EVIDENCE_CONTRACT_MISMATCH" };
    if (!metricEvidencePresentInUserSources && !metricEvidencePresentInApprovedReferences) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "METRIC_EVIDENCE_NOT_FOUND" };
    if (groupingTarget) {
      if (!intent.target) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "MISSING_GROUPING_TARGET" };
      if (!intent.targetEvidence) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "MISSING_TARGET_EVIDENCE" };
      if (normalizeEvidence(intent.target) !== normalizeEvidence(intent.targetEvidence)) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "TARGET_EVIDENCE_CONTRACT_MISMATCH" };
      if (normalizeEvidence(intent.target) !== normalizeEvidence(groupingTarget)) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "EXPLICIT_GROUPING_TARGET_MISMATCH" };
      if (!targetEvidencePresentInUserSources) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "TARGET_EVIDENCE_NOT_FOUND" };
    }
  }
  if (intent.queryType === "LOOKUP") {
    if (!intent.target || !intent.targetEvidence) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "MISSING_TARGET" };
    if (normalizeEvidence(intent.target) !== normalizeEvidence(intent.targetEvidence)) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "INVALID_INTENT_SHAPE" };
    if (!targetEvidencePresentInUserSources) return { ...base, validationOutcome: "CLARIFY", validationFailureReason: "TARGET_EVIDENCE_NOT_FOUND" };
  }
  return { ...base, validationOutcome: "QUERY", validationFailureReason: null };
}

export type IntentGateDecision =
  | { kind: "QUERY"; intent: ValidatedQueryIntent }
  | { kind: "CLARIFY"; intent: QueryIntent | null }
  | { kind: "CHAT"; intent: QueryIntent };

export function gateQueryIntent(intent: QueryIntent | null, userEvidence: string[], approvedReferenceEvidence: string[]): IntentGateDecision {
  if (!intent || intent.decision === "CLARIFY") return { kind: "CLARIFY", intent };
  if (intent.decision === "CHAT") return { kind: "CHAT", intent };
  const validated = validateQueryIntent(intent, userEvidence, approvedReferenceEvidence);
  return validated ? { kind: "QUERY", intent: validated } : { kind: "CLARIFY", intent };
}

export function clarificationForIntent(intent: QueryIntent | null): string {
  if (!intent || intent.decision === "QUERY" || intent.decision === "CLARIFY") {
    return "請指定要查詢的指標或對象；若要比較「表現」，請告訴我採用銷售額、銷售量或其他指標。";
  }
  return "我可以協助查詢資料，請描述您想查看的內容。";
}

export interface StoredConversationMessage {
  role: "user" | "assistant";
  content: string;
  metadata_json?: string | null;
}

export interface StoredQueryRun {
  id: string;
  generated_sql: string;
}

interface AgentContextMetadata {
  version: 1;
  intentCallId: string;
  intent: QueryIntent;
  queryCallId?: string;
  queryRunId?: string;
}

function storedAgentContext(value: unknown): AgentContextMetadata | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = (input: unknown): input is string => typeof input === "string" && /^[A-Za-z0-9_-]{1,128}$/u.test(input);
  if (record.version !== 1 || !id(record.intentCallId)) return null;
  const intent = parseQueryIntent({ id: record.intentCallId, name: RESOLVE_INTENT_TOOL.name, arguments: JSON.stringify(record.intent ?? null) });
  if (!intent) return null;
  if (record.queryCallId !== undefined && !id(record.queryCallId)) return null;
  if (record.queryRunId !== undefined && (typeof record.queryRunId !== "string" || record.queryRunId.length > 64)) return null;
  return {
    version: 1,
    intentCallId: record.intentCallId,
    intent,
    ...(typeof record.queryCallId === "string" ? { queryCallId: record.queryCallId } : {}),
    ...(typeof record.queryRunId === "string" ? { queryRunId: record.queryRunId } : {}),
  };
}

function metadataFor(row: StoredConversationMessage): Record<string, unknown> {
  try {
    const parsed = JSON.parse(row.metadata_json ?? "{}") as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
  } catch { return {}; }
}

/** Rebuild the provider's assistant-tool/tool-result sequence without granting historical authorization. */
export function reconstructConversationHistory(rows: StoredConversationMessage[], queryRuns: StoredQueryRun[]): ProviderMessage[] {
  const runs = new Map(queryRuns.map((run) => [run.id, run]));
  const history: ProviderMessage[] = [];
  for (const row of rows) {
    if (row.role === "user") {
      history.push({ role: "user", content: row.content });
      continue;
    }
    const metadata = metadataFor(row);
    const context = storedAgentContext(metadata.agentContext);
    if (!context) {
      history.push({ role: "assistant", content: row.content });
      continue;
    }
    const intentArguments = JSON.stringify(context.intent);
    history.push({ role: "assistant", content: null, toolCalls: [{ id: context.intentCallId, name: RESOLVE_INTENT_TOOL.name, arguments: intentArguments }] });
    history.push({ role: "tool", toolCallId: context.intentCallId, content: intentArguments });
    const run = context.queryRunId ? runs.get(context.queryRunId) : undefined;
    const queryRows = Array.isArray(metadata.rows) ? metadata.rows : [];
    const rowCount = typeof metadata.rowCount === "number" && Number.isSafeInteger(metadata.rowCount) ? metadata.rowCount : queryRows.length;
    if (run && context.queryCallId) {
      history.push({ role: "assistant", content: null, toolCalls: [{ id: context.queryCallId, name: RUN_SQL_TOOL.name, arguments: JSON.stringify({ sql: run.generated_sql }) }] });
      history.push({ role: "tool", toolCallId: context.queryCallId, content: JSON.stringify({ rowCount, rows: queryRows, truncatedForModel: queryRows.length < rowCount }) });
    }
    history.push({ role: "assistant", content: row.content });
  }
  return history;
}

export interface GroundingObservation {
  rows: Array<Record<string, unknown>>;
  rowCount: number;
}

export type NumericClaimCategory = "BUSINESS_VALUE" | "DERIVED_VALUE" | "ORDINAL / LIST INDEX" | "DATE/TIME" | "FORMATTING" | "UNSUPPORTED";

export interface NumericClaimEvidence {
  category: NumericClaimCategory;
  grounded: boolean;
  formatted: boolean;
}

function canonicalNumber(value: string): number | null {
  const normalized = value.normalize("NFKC").replace(/[,$，\s]/gu, "").replace(/^(?:NT\$|TWD|USD|\$)/iu, "").replace(/(?:元|%|％)$/u, "");
  if (!/^-?\d+(?:\.\d+)?$/u.test(normalized)) return null;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

function collectObservedNumbers(value: unknown, destination: Set<number>): void {
  if (typeof value === "number" && Number.isFinite(value)) destination.add(value);
  else if (typeof value === "string") {
    for (const match of value.normalize("NFKC").matchAll(/-?\d[\d,]*(?:\.\d+)?/gu)) {
      const number = canonicalNumber(match[0]);
      if (number !== null) destination.add(number);
    }
  } else if (Array.isArray(value)) value.forEach((item) => collectObservedNumbers(item, destination));
  else if (value && typeof value === "object") Object.values(value).forEach((item) => collectObservedNumbers(item, destination));
}

function derivedNumbers(observation: GroundingObservation): Set<number> {
  const values = new Set<number>();
  const byColumn = new Map<string, number[]>();
  for (const row of observation.rows) {
    for (const [key, value] of Object.entries(row)) {
      if (typeof value === "number" && Number.isFinite(value)) {
        values.add(value);
        if (!/(?:^|_)(?:id|uuid|code|year|month|day|date|time|rank|index|seq)(?:_|$)/iu.test(key)) {
          byColumn.set(key, [...(byColumn.get(key) ?? []), value]);
        }
      } else if (typeof value === "string") collectObservedNumbers(value, values);
    }
  }
  for (const columnValues of byColumn.values()) {
    if (columnValues.length < 2) continue;
    const total = columnValues.reduce((sum, value) => sum + value, 0);
    values.add(total);
    if (total !== 0) for (const value of columnValues) {
      const percentage = (value / total) * 100;
      for (const precision of [0, 1, 2]) values.add(Number(percentage.toFixed(precision)));
    }
  }
  return values;
}

function isInsideDateOrTime(text: string, position: number): boolean {
  const patterns = [
    /\b\d{4}[-/年]\s*\d{1,2}(?:[-/月]\s*\d{1,2}日?)?(?:\s+\d{1,2}:\d{2}(?::\d{2})?)?/gu,
    /\b\d{4}年/gu,
    /\b\d{1,2}:\d{2}(?::\d{2})?\b/gu,
  ];
  return patterns.some((pattern) => [...text.matchAll(pattern)].some((match) => position >= (match.index ?? 0) && position < (match.index ?? 0) + match[0].length));
}

/** In-memory only: returns classification metadata, never stores/logs the supplied answer. */
export function verifyNumericGrounding(answer: string, observation: GroundingObservation): NumericClaimEvidence[] {
  const normalizedAnswer = answer.normalize("NFKC");
  const observed = new Set<number>();
  collectObservedNumbers(observation.rows, observed);
  const derived = derivedNumbers(observation);
  const pattern = /-?\d[\d,，]*(?:\.\d+)?/gu;
  const claims: NumericClaimEvidence[] = [];
  for (const match of normalizedAnswer.matchAll(pattern)) {
    const index = match.index ?? 0;
    const lineStart = normalizedAnswer.lastIndexOf("\n", index - 1) + 1;
    const before = normalizedAnswer.slice(lineStart, index);
    const after = normalizedAnswer.slice(index + match[0].length);
    if (/^\s*$/u.test(before) && /^\s*[.)、]/u.test(after) || /第\s*$/u.test(before) && /^\s*(?:名|名次|位)/u.test(after)) {
      claims.push({ category: "ORDINAL / LIST INDEX", grounded: true, formatted: false });
      continue;
    }
    if (isInsideDateOrTime(normalizedAnswer, index)) {
      claims.push({ category: "DATE/TIME", grounded: true, formatted: false });
      continue;
    }
    const number = canonicalNumber(match[0]);
    const suffix = normalizedAnswer.slice(index + match[0].length, index + match[0].length + 6);
    const prefix = normalizedAnswer.slice(Math.max(lineStart, index - 8), index);
    const formatted = /[,，]/u.test(match[0]) || /(?:NT\$|TWD|USD|\$)\s*$/iu.test(prefix) || /^\s*(?:元|%|％)/u.test(suffix);
    const countContext = /(?:共|總共|共計|取得)\s*$/u.test(before) || /^\s*(?:筆(?:資料)?|rows?|records?|results?)/iu.test(suffix);
    if (number !== null && observed.has(number)) claims.push({ category: formatted ? "FORMATTING" : "BUSINESS_VALUE", grounded: true, formatted });
    else if (number !== null && number === observation.rowCount && countContext) claims.push({ category: "BUSINESS_VALUE", grounded: true, formatted });
    else if (number !== null && derived.has(number) && (/合計|總計|total/iu.test(before) || /[%％]/u.test(suffix) || /百分之\s*$/u.test(prefix))) claims.push({ category: "DERIVED_VALUE", grounded: true, formatted });
    else claims.push({ category: "UNSUPPORTED", grounded: false, formatted });
  }
  return claims;
}

export function numericGroundingSummary(claims: NumericClaimEvidence[]): { claimCount: number; unsupportedCount: number; categories: Record<NumericClaimCategory, number> } {
  const categories: Record<NumericClaimCategory, number> = {
    BUSINESS_VALUE: 0, DERIVED_VALUE: 0, "ORDINAL / LIST INDEX": 0, "DATE/TIME": 0, FORMATTING: 0, UNSUPPORTED: 0,
  };
  for (const claim of claims) categories[claim.category] += 1;
  return { claimCount: claims.length, unsupportedCount: categories.UNSUPPORTED, categories };
}
