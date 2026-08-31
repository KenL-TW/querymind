import { HttpError, readJson } from "../lib/http";
import { authorizeQuery } from "../lib/query-policy";
import { resolveEffectiveScope } from "../lib/scope";
import { requireUser, requireCapability, hasCapability } from "../lib/auth";
import { ensureOwnedSession } from "../lib/sessions";
import { assertNoSensitiveInference, maskedQueryRows } from "../lib/dlp";
import { assertApiResultBudget, boundedResultPreview } from "../lib/result-budget";
import { consumeRateLimit, hashSubject } from "../lib/rate-limit";
import { buildQueryExplainability, type QueryExplainability } from "../lib/explainability";

interface QueryRequest {
  sql: unknown;
  sessionId?: unknown;
  prompt?: unknown;
}

function requestShape(value: unknown): QueryRequest {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  }
  return value as QueryRequest;
}

function optionalString(value: unknown, field: string): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || !value.trim()) {
    throw new HttpError(400, "INVALID_REQUEST", `${field} must be a non-empty string when provided.`);
  }
  return value.trim();
}

async function recordQueryRun(
  env: Env,
  input: {
    sessionId: string | null;
    userId: string;
    prompt: string | null;
    generatedSql: string;
    rowCount: number;
    durationMs: number;
    outcome: "success" | "rejected" | "error";
    errorCode: string | null;
    result?: { rows: Record<string, unknown>[]; maskedColumns: string[] };
    rowCap?: number;
    explainability?: QueryExplainability;
    allowRawSql?: boolean;
    runId?: string;
  },
): Promise<string> {
  const now = new Date().toISOString();
  const runId = input.runId ?? crypto.randomUUID();
  const auditId = crypto.randomUUID();
  const statements = [
    env.QUERYMIND_APP.prepare(
      "INSERT INTO query_runs (id, session_id, user_id, prompt, generated_sql, validated_sql, row_count, duration_ms, outcome, error_code, explainability_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    ).bind(runId, input.sessionId, input.userId, input.prompt ?? input.generatedSql, input.generatedSql, input.generatedSql, input.rowCount, input.durationMs, input.outcome, input.errorCode, JSON.stringify(input.explainability ?? {}), now),
    env.QUERYMIND_APP.prepare(
      "INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    ).bind(auditId, input.userId, "query.executed", "query_run", runId, JSON.stringify({ outcome: input.outcome, rowCount: input.rowCount, durationMs: input.durationMs }), now),
  ];
  if (input.sessionId && input.outcome === "success" && input.result) {
    const preview = boundedResultPreview(input.result.rows);
    statements.push(
      env.QUERYMIND_APP.prepare("INSERT INTO chat_messages (id, session_id, role, content, metadata_json, created_at) VALUES (?, ?, 'user', ?, '{}', ?)").bind(crypto.randomUUID(), input.sessionId, input.prompt ?? "執行已儲存的 SQL 查詢", now),
      env.QUERYMIND_APP.prepare("INSERT INTO chat_messages (id, session_id, role, content, metadata_json, created_at) VALUES (?, ?, 'assistant', ?, ?, ?)").bind(
        crypto.randomUUID(),
        input.sessionId,
        `查詢完成，共取得 ${input.rowCount} 筆資料。`,
        JSON.stringify({ sql: input.allowRawSql ? input.generatedSql : "redacted", rows: preview, rowCount: input.rowCount, truncated: input.result.rows.length > preview.length, maskedColumns: input.result.maskedColumns, durationMs: input.durationMs, source: "direct-query", queryRunId: runId, explainability: input.explainability }),
        now,
      ),
      env.QUERYMIND_APP.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ? AND user_id = ?").bind(now, input.sessionId, input.userId),
    );
  }
  await env.QUERYMIND_APP.batch(statements);
  return runId;
}

export async function executeQuery(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "chat");
  const [userSubject, globalSubject] = await Promise.all([
    hashSubject(`query:${user.id}`),
    hashSubject("query:global"),
  ]);
  await consumeRateLimit(env.QUERYMIND_APP, userSubject, 3_600, 30);
  await consumeRateLimit(env.QUERYMIND_APP, globalSubject, 86_400, 200);
  const body = requestShape(await readJson(request));
  const scope = await resolveEffectiveScope(env, user);
  const validated = await authorizeQuery(env, scope, body.sql, user.maxRows);
  const sessionId = optionalString(body.sessionId, "sessionId");
  if (sessionId) await ensureOwnedSession(env, sessionId, user.id);
  const prompt = optionalString(body.prompt, "prompt");
  const startedAt = Date.now();

  try {
    await assertNoSensitiveInference(env, validated.originalSql);
    const result = await env.QUERYMIND_DATA.prepare(validated.executionSql).all<Record<string, unknown>>();
    const rows = result.results ?? [];
    const masked = await maskedQueryRows(env, rows, validated.originalSql);
    const durationMs = Date.now() - startedAt;
    const runId = crypto.randomUUID();
    const allowRawSql = hasCapability(user, "view_schema");
    // Direct Query is governed but never consumes P2-F semantic model context.
    const explainability = buildQueryExplainability({ prompt, sql: validated.originalSql, scope, referencedTables: validated.referencedTables, rowCount: rows.length, truncated: rows.length >= validated.rowCap, maskedColumns: masked.maskedColumns, queryRunId: runId, rawSqlAvailable: allowRawSql, semanticEvidenceMode: "NOT_USED" });
    const payload = { rows: masked.rows, rowCount: rows.length, rowCap: validated.rowCap, maskedColumns: masked.maskedColumns, durationMs, queryRunId: runId, explainability, ...(allowRawSql ? { sql: validated.originalSql } : {}) };
    assertApiResultBudget(payload);
    await recordQueryRun(env, { sessionId, userId: user.id, prompt, generatedSql: validated.originalSql, rowCount: rows.length, durationMs, outcome: "success", errorCode: null, result: masked, rowCap: validated.rowCap, explainability, allowRawSql, runId });
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    const code = error instanceof HttpError ? error.code : "QUERY_EXECUTION_FAILED";
    await recordQueryRun(env, { sessionId, userId: user.id, prompt, generatedSql: validated.originalSql, rowCount: 0, durationMs, outcome: "error", errorCode: code, rowCap: validated.rowCap });
    throw error;
  }
}
