import { createPasswordRecord, hashOpaqueSecret, validateEmail, validatePassword } from "../lib/auth";
import { HttpError, json, readJson } from "../lib/http";
import { objectBody, optionalText, requiredText } from "../lib/product";

export async function invitationPreview(request: Request, env: Env): Promise<Response> {
  // Tokens are accepted only in a POST body so they never enter access-log,
  // referrer, browser-history, or intermediary URL fields.
  const body = objectBody(await readJson(request));
  const token = requiredText(body.token, "token", 200);
  const invitation = await env.QUERYMIND_APP.prepare("SELECT email, role_name, expires_at, accepted_at, revoked_at FROM invitations WHERE token_hash = ?").bind(await hashOpaqueSecret(token, env)).first<{ email: string; role_name: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>();
  if (!invitation || invitation.accepted_at || invitation.revoked_at || invitation.expires_at <= new Date().toISOString()) throw new HttpError(404, "INVITATION_NOT_AVAILABLE", "Invitation is unavailable or expired.");
  return json({ invitation: { email: invitation.email, roleName: invitation.role_name, expiresAt: invitation.expires_at } });
}

export async function acceptInvitation(request: Request, env: Env): Promise<Response> {
  const body = objectBody(await readJson(request));
  const token = requiredText(body.token, "token", 200); const email = validateEmail(body.email); const password = validatePassword(body.password); const displayName = optionalText(body.displayName, "displayName", 100) || email.split("@")[0];
  const tokenHash = await hashOpaqueSecret(token, env);
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const invitation = await env.QUERYMIND_APP.prepare("SELECT id, email, role_name, expires_at, accepted_at, revoked_at FROM invitations WHERE token_hash = ?").bind(tokenHash).first<{ id: string; email: string; role_name: string; expires_at: string; accepted_at: string | null; revoked_at: string | null }>();
  if (!invitation || invitation.email !== email || invitation.accepted_at || invitation.revoked_at || invitation.expires_at <= now) {
    throw new HttpError(400, "INVITATION_NOT_AVAILABLE", "Invitation is unavailable, expired, or does not match this email.");
  }
  const existingUser = await env.QUERYMIND_APP.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
  if (existingUser) throw new HttpError(409, "ACCOUNT_EXISTS", "An account already exists for this email.");
  // Avoid spending a slow password KDF on obviously invalid public tokens. The
  // transactional claim below still revalidates every condition.
  const credential = await createPasswordRecord(password, env);

  // D1 batch statements execute sequentially in one transaction. Claim the
  // invitation only if it is still active and no account exists, then create
  // the user exclusively from that exact claim. Concurrent accept/revoke calls
  // therefore cannot create an account from stale preflight state.
  const results = await env.QUERYMIND_APP.batch([
    env.QUERYMIND_APP.prepare(
      `UPDATE invitations SET accepted_at = ?
       WHERE id = ? AND token_hash = ? AND email = ?
         AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at > ?
         AND NOT EXISTS (SELECT 1 FROM users WHERE email = ?)`,
    ).bind(now, invitation.id, tokenHash, email, now, email),
    env.QUERYMIND_APP.prepare(
      `INSERT INTO users (id, email, display_name, password_salt, password_hash, password_algorithm, password_updated_at, role_name, is_active, updated_at, created_at, last_seen_at)
       SELECT ?, i.email, ?, ?, ?, ?, ?, i.role_name, 1, ?, ?, ?
       FROM invitations i
       WHERE i.id = ? AND i.token_hash = ? AND i.email = ?
         AND i.accepted_at = ? AND i.revoked_at IS NULL AND i.expires_at > ?
         AND NOT EXISTS (SELECT 1 FROM users WHERE email = i.email)`,
    ).bind(userId, displayName, credential.salt, credential.hash, credential.algorithm, now, now, now, now, invitation.id, tokenHash, email, now, now),
    env.QUERYMIND_APP.prepare(
      `INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at)
       SELECT ?, ?, 'invitation.accepted', 'invitation', ?, '{}', ?
       WHERE EXISTS (SELECT 1 FROM users WHERE id = ? AND email = ?)`,
    ).bind(crypto.randomUUID(), userId, invitation.id, now, userId, email),
  ]);
  const claimed = results[0]?.meta.changes ?? 0;
  const created = results[1]?.meta.changes ?? 0;
  if (claimed !== 1 || created !== 1) {
    const prior = await env.QUERYMIND_APP.prepare("SELECT id FROM users WHERE email = ?").bind(email).first();
    if (prior) throw new HttpError(409, "ACCOUNT_EXISTS", "An account already exists for this email.");
    throw new HttpError(400, "INVITATION_NOT_AVAILABLE", "Invitation is unavailable, expired, revoked, already used, or does not match this email.");
  }
  return json({ ok: true, email, roleName: invitation.role_name }, 201);
}
