/** QueryMind Worker entry point. No request state or credentials are stored in module scope. */

import { aiAvailability, type AiAvailability } from "./lib/ai-config";
import { errorResponse, json } from "./lib/http";
import { assertStaticRuntimeConfiguration } from "./lib/runtime-config";
import { policyState } from "./lib/scope";
import { chat } from "./routes/agent";
import { authStatus, bootstrap, bootstrapStatus, changePassword, currentUser, login, logout } from "./routes/auth";
import { executeQuery } from "./routes/query";
import { getSchema, refreshSchema } from "./routes/schema";
import { addMessage, createSession, deleteSession, listMessages, listSessions, sessionPath, updateSession } from "./routes/sessions";
import { currentUsage, publicConfiguration } from "./routes/system";
import { submitQueryFeedback } from "./routes/feedback";
import { acceptInvitation, invitationPreview } from "./routes/invitations";
import { adminOverview, auditLog, connectionInfo, createApiKey, createInsight, createInvitation, createTemplate, dashboard, deleteDictionary, deleteInsight, deleteTemplate, exportCsv, listApiKeys, listDictionary, listInsights, listInvitations, listRoles, listTemplates, listUsers, resetUserPassword, revokeApiKey, revokeInvitation, saveDictionary, systemInfo, updateInsight, updateRole, updateTemplate, updateUser } from "./routes/modules";

type HealthDatabase = "ok" | "unavailable";

interface HealthPayload {
  service: "querymind";
  status: "ok" | "degraded";
  environment: string;
  ai: AiAvailability;
  databases: { data: HealthDatabase; app: HealthDatabase };
  policy: { ok: boolean; policyVersion: string | null; expectedMigration: string | null; policyCount: number };
}

async function checkAppDatabase(database: D1Database): Promise<HealthDatabase> {
  try {
    const row = await database.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'table' AND name IN ('users', 'role_definitions', 'schema_catalog_tables', 'rate_limit_counters', 'audit_events', 'data_scope_policies', 'policy_state', 'query_feedback')").first<{ total: number }>();
    return row?.total === 8 ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function checkDataDatabase(database: D1Database): Promise<HealthDatabase> {
  try {
    const row = await database.prepare("SELECT COUNT(*) AS total FROM sqlite_schema WHERE type = 'table' AND sql IS NOT NULL AND name NOT LIKE 'sqlite_%' AND name NOT LIKE 'd1_%' AND name NOT LIKE '_cf_%'").first<{ total: number }>();
    return (row?.total ?? 0) > 0 ? "ok" : "unavailable";
  } catch {
    return "unavailable";
  }
}

async function health(env: Env): Promise<Response> {
  const [data, app] = await Promise.all([
    checkDataDatabase(env.QUERYMIND_DATA),
    checkAppDatabase(env.QUERYMIND_APP),
  ]);
  const ai = aiAvailability(env);
  const policy = await policyState(env);
  let configOk = true;
  try { assertStaticRuntimeConfiguration(env); } catch { configOk = false; }
  const ready = data === "ok" && app === "ok" && policy.ok && ai !== "pending" && configOk;
  const payload: HealthPayload = {
    service: "querymind",
    status: ready ? "ok" : "degraded",
    environment: env.ENVIRONMENT,
    ai,
    databases: { data, app },
    policy,
  };
  return json(payload, payload.status === "ok" ? 200 : 503);
}

async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (url.pathname !== "/health") assertStaticRuntimeConfiguration(env);
  if (request.method === "GET" && url.pathname === "/health") return health(env);
  if (request.method === "POST" && url.pathname === "/api/v1/query") return executeQuery(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/auth/bootstrap") return bootstrap(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/auth/bootstrap-status") return bootstrapStatus(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/auth/login") return login(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/auth/logout") return logout(env);
  if (request.method === "POST" && url.pathname === "/api/v1/auth/change-password") return changePassword(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/auth/invitation") return invitationPreview(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/auth/accept-invitation") return acceptInvitation(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/auth/status") return authStatus(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/me") return currentUser(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/config") return publicConfiguration(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/usage") return currentUsage(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/dashboard") return dashboard(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/export/csv") return exportCsv(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/templates") return listTemplates(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/templates") return createTemplate(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/insights") return listInsights(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/insights") return createInsight(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/dictionary") return listDictionary(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/dictionary") return saveDictionary(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/overview") return adminOverview(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/users") return listUsers(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/roles") return listRoles(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/invitations") return listInvitations(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/admin/invitations") return createInvitation(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/audit") return auditLog(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/connection") return connectionInfo(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/admin/system") return systemInfo(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/sessions") return listSessions(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/sessions") return createSession(request, env);
  if (request.method === "GET" && url.pathname === "/api/v1/schema") return getSchema(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/schema/refresh") return refreshSchema(request, env);
  if (request.method === "POST" && url.pathname === "/api/v1/chat") return chat(request, env);

  const session = sessionPath(url.pathname);
  if (session?.isMessages && request.method === "GET") return listMessages(request, env, session.sessionId);
  if (session?.isMessages && request.method === "POST") return addMessage(request, env, session.sessionId);
  if (session && request.method === "PATCH") return updateSession(request, env, session.sessionId);
  if (session && request.method === "DELETE") return deleteSession(request, env, session.sessionId);
  const feedback = url.pathname.match(/^\/api\/v1\/query-runs\/([0-9a-f-]{36})\/feedback$/iu);
  if (feedback && request.method === "POST") return submitQueryFeedback(request, env, feedback[1]);
  const template = url.pathname.match(/^\/api\/v1\/templates\/([0-9a-f-]{36}|template-[a-z-]+)$/iu);
  if (template && request.method === "PATCH") return updateTemplate(request, env, template[1]);
  if (template && request.method === "DELETE") return deleteTemplate(request, env, template[1]);
  const insight = url.pathname.match(/^\/api\/v1\/insights\/([0-9a-f-]{36})$/iu);
  if (insight && request.method === "PATCH") return updateInsight(request, env, insight[1]);
  if (insight && request.method === "DELETE") return deleteInsight(request, env, insight[1]);
  const dictionary = url.pathname.match(/^\/api\/v1\/dictionary\/([0-9a-f-]{36})$/iu);
  if (dictionary && request.method === "PUT") return saveDictionary(request, env, dictionary[1]);
  if (dictionary && request.method === "DELETE") return deleteDictionary(request, env, dictionary[1]);
  const adminUser = url.pathname.match(/^\/api\/v1\/admin\/users\/([0-9a-f-]{36})$/iu);
  if (adminUser && request.method === "PATCH") return updateUser(request, env, adminUser[1]);
  const passwordReset = url.pathname.match(/^\/api\/v1\/admin\/users\/([0-9a-f-]{36})\/reset-password$/iu);
  if (passwordReset && request.method === "POST") return resetUserPassword(request, env, passwordReset[1]);
  const role = url.pathname.match(/^\/api\/v1\/admin\/roles\/(viewer|analyst|editor|dba|owner)$/iu);
  if (role && request.method === "PATCH") return updateRole(request, env, role[1].toLowerCase());
  const invitation = url.pathname.match(/^\/api\/v1\/admin\/invitations\/([0-9a-f-]{36})$/iu);
  if (invitation && request.method === "DELETE") return revokeInvitation(request, env, invitation[1]);
  const userKeys = url.pathname.match(/^\/api\/v1\/admin\/users\/([0-9a-f-]{36})\/keys$/iu);
  if (userKeys && request.method === "GET") return listApiKeys(request, env, userKeys[1]);
  if (userKeys && request.method === "POST") return createApiKey(request, env, userKeys[1]);
  const apiKey = url.pathname.match(/^\/api\/v1\/admin\/keys\/([0-9a-f-]{36})$/iu);
  if (apiKey && request.method === "DELETE") return revokeApiKey(request, env, apiKey[1]);
  if (url.pathname.startsWith("/api/")) return json({ error: "API_NOT_IMPLEMENTED", message: "This endpoint is not available." }, 404);
  return env.ASSETS.fetch(request);
}

function withSecurityHeaders(response: Response, env: Env): Response {
  const headers = new Headers(response.headers);
  headers.set("x-content-type-options", "nosniff");
  headers.set("referrer-policy", "strict-origin-when-cross-origin");
  headers.set("permissions-policy", "camera=(), microphone=(), geolocation=()");
  headers.set("x-frame-options", "DENY");
  headers.set("content-security-policy", "default-src 'self'; base-uri 'none'; connect-src 'self'; font-src 'self'; form-action 'self'; frame-ancestors 'none'; img-src 'self' data:; object-src 'none'; script-src 'self'; style-src 'self'");
  if (String(env.ENVIRONMENT) !== "local") headers.set("strict-transport-security", "max-age=31536000; includeSubDomains");
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });
}

export default {
  async fetch(request, env): Promise<Response> {
    try {
      return withSecurityHeaders(await route(request, env), env);
    } catch (error) {
      console.error(JSON.stringify({ event: "request.failed", message: error instanceof Error ? error.message : "Unknown error" }));
      return withSecurityHeaders(errorResponse(error), env);
    }
  },
} satisfies ExportedHandler<Env>;
