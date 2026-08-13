import { aiAvailability } from "../lib/ai-config";
import { requireUser } from "../lib/auth";
import { json } from "../lib/http";

export async function publicConfiguration(request: Request, env: Env): Promise<Response> {
  await requireUser(request, env);
  return json({
    environment: env.ENVIRONMENT,
    ai: {
      availability: aiAvailability(env),
      model: env.OPENAI_MODEL,
      userRequestsPerHour: Number(env.AI_USER_REQUESTS_PER_HOUR),
      globalRequestsPerDay: Number(env.AI_GLOBAL_REQUESTS_PER_DAY),
      maxPromptCharacters: Number(env.AI_MAX_PROMPT_CHARACTERS),
    },
  });
}

export async function currentUsage(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const row = await env.QUERYMIND_APP.prepare(
    `SELECT COUNT(*) AS requests,
            COALESCE(SUM(provider_requests), 0) AS provider_requests,
            COALESCE(SUM(row_count), 0) AS query_rows,
            COALESCE(SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END), 0) AS successful_requests
     FROM ai_usage_events WHERE user_id = ? AND created_at >= ?`,
  ).bind(user.id, since).first<{ requests: number; provider_requests: number; query_rows: number; successful_requests: number }>();
  return json({
    period: "rolling_24_hours",
    requests: row?.requests ?? 0,
    providerRequests: row?.provider_requests ?? 0,
    queryRows: row?.query_rows ?? 0,
    successfulRequests: row?.successful_requests ?? 0,
  });
}
