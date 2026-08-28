import { requireUser } from "../lib/auth";
import { audit } from "../lib/audit";
import {
  FEEDBACK_VERSION,
  feedbackRatingForResponse,
  feedbackRatingForStorage,
  legacyCategory,
  parseFeedbackInput,
  parseStoredExplainability,
  targetExistsInExplainability,
} from "../lib/feedback";
import { HttpError, json, readJson } from "../lib/http";

function bodyObject(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

export async function submitQueryFeedback(request: Request, env: Env, queryRunId: string): Promise<Response> {
  const user = await requireUser(request, env);
  const body = bodyObject(await readJson(request));
  const input = parseFeedbackInput(body);
  const run = await env.QUERYMIND_APP.prepare("SELECT id, user_id, outcome, explainability_json FROM query_runs WHERE id = ?").bind(queryRunId).first<{ id: string; user_id: string; outcome: string; explainability_json?: string | null }>();
  if (!run || run.user_id !== user.id || run.outcome !== "success") throw new HttpError(404, "QUERY_RUN_NOT_FOUND", "The query run is not available for feedback.");
  if (!targetExistsInExplainability(input.target, parseStoredExplainability(run.explainability_json))) throw new HttpError(400, "INVALID_FEEDBACK_TARGET", "The selected evidence is not part of this query result.");
  const now = new Date().toISOString();
  const feedbackId = crypto.randomUUID();
  const rating = feedbackRatingForStorage(input.rating);
  const category = legacyCategory(input.category);
  const version = input.legacy ? "p1" : FEEDBACK_VERSION;
  await env.QUERYMIND_APP.prepare(
    "INSERT INTO query_feedback (id, query_run_id, user_id, rating, category, comment, feedback_version, target_type, target_ref, issue_category, correction_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(query_run_id, user_id) DO UPDATE SET rating = excluded.rating, category = excluded.category, comment = excluded.comment, feedback_version = excluded.feedback_version, target_type = excluded.target_type, target_ref = excluded.target_ref, issue_category = excluded.issue_category, correction_text = excluded.correction_text, updated_at = excluded.updated_at",
  ).bind(feedbackId, queryRunId, user.id, rating, category, input.comment, version, input.target.type, input.target.ref, input.category, input.correction, now, now).run();
  const responseRating = feedbackRatingForResponse(rating, version);
  await audit(env, { actorId: user.id, eventType: input.legacy ? "query.feedback.upserted" : "QUERY_FEEDBACK_SUBMITTED", resourceType: "query_run", resourceId: queryRunId, metadata: { feedbackId, queryRunId, version, rating: responseRating, targetType: input.target.type, category: input.category } });
  return json({ ok: true, queryRunId, rating: responseRating, category: input.category, feedback: { id: feedbackId, version, rating: responseRating, target: input.target, category: input.category, submittedAt: now } });
}
