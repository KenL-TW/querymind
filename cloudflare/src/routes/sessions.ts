import { requireCapability, requireUser } from "../lib/auth";
import { audit } from "../lib/audit";
import { HttpError, json, readJson } from "../lib/http";
import { ensureOwnedSession, sessionResponse, type SessionRow } from "../lib/sessions";
import { consumeRateLimit, hashSubject } from "../lib/rate-limit";

const SESSION_RETENTION_DAYS = 90;
const AUDIT_RETENTION_DAYS = 180;

/**
 * Bound D1 growth without Cron or another paid component. A daily conditional
 * write elects at most one request to clean small batches; ordinary session
 * creation therefore never scans the history tables.
 */
async function pruneExpiredMetadata(env: Env, now: Date): Promise<void> {
  const sessionCutoff = new Date(now.getTime() - SESSION_RETENTION_DAYS * 86_400_000).toISOString();
  const auditCutoff = new Date(now.getTime() - AUDIT_RETENTION_DAYS * 86_400_000).toISOString();
  const day = now.toISOString().slice(0, 10);
  const gate = await env.QUERYMIND_APP.prepare(
    `INSERT INTO system_settings (setting_key, setting_value, updated_at)
     VALUES ('retention.last_cleanup_day', ?, ?)
     ON CONFLICT(setting_key) DO UPDATE SET setting_value = excluded.setting_value, updated_at = excluded.updated_at
     WHERE system_settings.setting_value < excluded.setting_value
     RETURNING setting_value`,
  ).bind(day, now.toISOString()).first<{ setting_value: string }>();
  if (!gate) return;
  await env.QUERYMIND_APP.batch([
    env.QUERYMIND_APP.prepare("DELETE FROM chat_sessions WHERE id IN (SELECT id FROM chat_sessions WHERE pinned = 0 AND updated_at < ? LIMIT 100)").bind(sessionCutoff),
    env.QUERYMIND_APP.prepare("DELETE FROM query_runs WHERE id IN (SELECT id FROM query_runs WHERE created_at < ? LIMIT 100)").bind(auditCutoff),
    env.QUERYMIND_APP.prepare("DELETE FROM ai_usage_events WHERE id IN (SELECT id FROM ai_usage_events WHERE created_at < ? LIMIT 100)").bind(auditCutoff),
    env.QUERYMIND_APP.prepare("DELETE FROM audit_events WHERE id IN (SELECT id FROM audit_events WHERE created_at < ? LIMIT 100)").bind(auditCutoff),
  ]);
}

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

function optionalText(value: unknown, field: string, maxLength: number): string | null {
  if (value === undefined) return null;
  if (typeof value !== "string" || value.trim().length > maxLength) throw new HttpError(400, "INVALID_REQUEST", `${field} must be a string up to ${maxLength} characters.`);
  return value.trim();
}

function optionalBoolean(value: unknown, field: string): boolean | null {
  if (value === undefined) return null;
  if (typeof value !== "boolean") throw new HttpError(400, "INVALID_REQUEST", `${field} must be a boolean.`);
  return value;
}

function parseId(pathname: string): { sessionId: string; isMessages: boolean } | null {
  const match = pathname.match(/^\/api\/v1\/sessions\/([0-9a-f-]{36})(\/messages)?$/iu);
  if (!match) return null;
  return { sessionId: match[1], isMessages: Boolean(match[2]) };
}

export async function listSessions(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "manage_own_sessions");
  const archivedOnly = new URL(request.url).searchParams.get("archived") === "true";
  const result = await env.QUERYMIND_APP.prepare(
    `SELECT id, user_id, title, summary, entities_json, pinned, archived, created_at, updated_at
     FROM chat_sessions WHERE user_id = ? AND archived = ${archivedOnly ? "1" : "0"}
     ORDER BY pinned DESC, updated_at DESC LIMIT 100`,
  ).bind(user.id).all<SessionRow>();
  return json({ sessions: (result.results ?? []).map(sessionResponse) });
}

export async function createSession(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "manage_own_sessions");
  await consumeRateLimit(env.QUERYMIND_APP, await hashSubject(`session-create:${user.id}`), 3_600, 30);
  const body = objectBody(await readJson(request));
  const title = optionalText(body.title, "title", 160) ?? "New conversation";
  const currentTime = new Date();
  const now = currentTime.toISOString();
  const session: SessionRow = { id: crypto.randomUUID(), user_id: user.id, title, summary: "", entities_json: "[]", pinned: 0, archived: 0, created_at: now, updated_at: now };
  await pruneExpiredMetadata(env, currentTime);
  await env.QUERYMIND_APP.prepare(
    "INSERT INTO chat_sessions (id, user_id, title, summary, entities_json, pinned, archived, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
  ).bind(session.id, session.user_id, session.title, session.summary, session.entities_json, session.pinned, session.archived, now, now).run();
  return json({ session: sessionResponse(session) }, 201);
}

export async function updateSession(request: Request, env: Env, sessionId: string): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "manage_own_sessions");
  const body = objectBody(await readJson(request));
  const existing = await ensureOwnedSession(env, sessionId, user.id);
  const title = optionalText(body.title, "title", 160);
  const summary = optionalText(body.summary, "summary", 4_000);
  const pinned = optionalBoolean(body.pinned, "pinned");
  const archived = optionalBoolean(body.archived, "archived");
  if (title === null && summary === null && pinned === null && archived === null) throw new HttpError(400, "INVALID_REQUEST", "At least one editable field is required.");
  const now = new Date().toISOString();
  const next: SessionRow = { ...existing, title: title ?? existing.title, summary: summary ?? existing.summary, pinned: pinned === null ? existing.pinned : Number(pinned), archived: archived === null ? existing.archived : Number(archived), updated_at: now };
  await env.QUERYMIND_APP.prepare("UPDATE chat_sessions SET title = ?, summary = ?, pinned = ?, archived = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(next.title, next.summary, next.pinned, next.archived, now, sessionId, user.id).run();
  return json({ session: sessionResponse(next) });
}

export async function listMessages(request: Request, env: Env, sessionId: string): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "manage_own_sessions");
  await ensureOwnedSession(env, sessionId, user.id);
  const result = await env.QUERYMIND_APP.prepare("SELECT id, role, content, metadata_json, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT 500").bind(sessionId).all<{ id: string; role: string; content: string; metadata_json: string; created_at: string }>();
  return json({ messages: result.results ?? [] });
}

export async function addMessage(request: Request, env: Env, sessionId: string): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "manage_own_sessions");
  await ensureOwnedSession(env, sessionId, user.id);
  const body = objectBody(await readJson(request));
  const role = body.role;
  const content = optionalText(body.content, "content", 12_000);
  // Assistant, system and tool messages are written exclusively by the agent.
  // Keeping this public endpoint user-only prevents forged agent history.
  if (role !== "user" || content === null) throw new HttpError(400, "INVALID_REQUEST", "Only a user message and content are permitted.");
  const now = new Date().toISOString();
  const message = { id: crypto.randomUUID(), role, content, createdAt: now };
  await env.QUERYMIND_APP.batch([
    env.QUERYMIND_APP.prepare("INSERT INTO chat_messages (id, session_id, role, content, metadata_json, created_at) VALUES (?, ?, ?, ?, '{}', ?)").bind(message.id, sessionId, role, content, now),
    env.QUERYMIND_APP.prepare("UPDATE chat_sessions SET updated_at = ? WHERE id = ?").bind(now, sessionId),
  ]);
  return json({ message }, 201);
}

export async function deleteSession(request: Request, env: Env, sessionId: string): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "manage_own_sessions");
  const result = await env.QUERYMIND_APP.prepare("DELETE FROM chat_sessions WHERE id = ? AND user_id = ?").bind(sessionId, user.id).run();
  if (!result.meta.changes) throw new HttpError(404, "SESSION_NOT_FOUND", "Session was not found.");
  await audit(env, { actorId: user.id, eventType: "session.deleted", resourceType: "session", resourceId: sessionId });
  return json({ ok: true });
}

export function sessionPath(pathname: string): { sessionId: string; isMessages: boolean } | null {
  return parseId(pathname);
}
