import { HttpError } from "./http";

export interface SessionRow {
  id: string;
  user_id: string | null;
  title: string;
  summary: string;
  entities_json: string;
  pinned: number;
  archived: number;
  created_at: string;
  updated_at: string;
}

export async function ensureOwnedSession(env: Env, sessionId: string, userId: string): Promise<SessionRow> {
  const session = await env.QUERYMIND_APP.prepare(
    "SELECT id, user_id, title, summary, entities_json, pinned, archived, created_at, updated_at FROM chat_sessions WHERE id = ? AND user_id = ?",
  ).bind(sessionId, userId).first<SessionRow>();
  if (!session) throw new HttpError(404, "SESSION_NOT_FOUND", "Session was not found.");
  return session;
}

export function sessionResponse(session: SessionRow): Record<string, unknown> {
  let entities: unknown[] = [];
  try {
    const parsed = JSON.parse(session.entities_json) as unknown;
    if (Array.isArray(parsed)) entities = parsed;
  } catch {
    // A corrupted legacy row cannot break the session list.
  }
  return {
    id: session.id,
    title: session.title,
    summary: session.summary,
    entities,
    pinned: session.pinned === 1,
    archived: session.archived === 1,
    createdAt: session.created_at,
    updatedAt: session.updated_at,
  };
}
