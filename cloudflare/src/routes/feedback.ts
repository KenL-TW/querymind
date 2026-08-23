import { requireUser } from "../lib/auth";
import { audit } from "../lib/audit";
import { HttpError, json, readJson } from "../lib/http";

const CATEGORIES = new Set(["interpretation", "source", "calculation", "incomplete", "scope", "other"]);

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

export async function submitQueryFeedback(request: Request, env: Env, queryRunId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const body = bodyObject(await readJson(request));
  const rating = body.rating;
  if (rating !== "positive" && rating !== "negative") throw new HttpError(400, "INVALID_FEEDBACK", "rating must be positive or negative.");
  const category = body.category === undefined || body.category === null || body.category === "" ? null : body.category;
  if (category !== null && (typeof category !== "string" || !CATEGORIES.has(category))) throw new HttpError(400, "INVALID_FEEDBACK", "category is not supported.");
  if (rating === "negative" && category === null) throw new HttpError(400, "INVALID_FEEDBACK", "A category is required for negative feedback.");
  const comment = body.comment === undefined || body.comment === null ? "" : body.comment;
  if (typeof comment !== "string" || comment.length > 800) throw new HttpError(400, "INVALID_FEEDBACK", "comment must be at most 800 characters.");

  const run = await env.QUERYMIND_APP.prepare("SELECT id, user_id, outcome FROM query_runs WHERE id = ?").bind(queryRunId).first<{ id: string; user_id: string; outcome: string }>();
  if (!run || run.user_id !== user.id || run.outcome !== "success") throw new HttpError(404, "QUERY_RUN_NOT_FOUND", "The query run is not available for feedback.");
  const now = new Date().toISOString();
  const feedbackId = crypto.randomUUID();
  await env.QUERYMIND_APP.prepare(
    "INSERT INTO query_feedback (id, query_run_id, user_id, rating, category, comment, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(query_run_id, user_id) DO UPDATE SET rating = excluded.rating, category = excluded.category, comment = excluded.comment, updated_at = excluded.updated_at",
  ).bind(feedbackId, queryRunId, user.id, rating, category, comment, now, now).run();
  await audit(env, { actorId: user.id, eventType: "query.feedback.upserted", resourceType: "query_run", resourceId: queryRunId, metadata: { rating, category } });
  return json({ ok: true, queryRunId, rating, category });
}
