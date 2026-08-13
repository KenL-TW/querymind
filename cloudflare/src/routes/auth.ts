import { bootstrapUser, changePasswordForUser, createSessionToken, expiredSessionCookie, loginUser, requireUser, sessionCookie, validateEmail, validatePassword } from "../lib/auth";
import { audit } from "../lib/audit";
import { HttpError, json, readJson } from "../lib/http";
import { consumeRateLimit, hashSubject } from "../lib/rate-limit";

function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

function publicUser(user: { id: string; email: string; displayName: string; roleName: string; capabilities: string[]; maxRows: number }): Record<string, unknown> {
  return { id: user.id, email: user.email, displayName: user.displayName, roleName: user.roleName, capabilities: user.capabilities, permissions: { maxRowsPerQuery: user.maxRows, canExport: user.capabilities.includes("*") || user.capabilities.includes("export") } };
}

function authResponse(user: { id: string; email: string; displayName: string; roleName: string; capabilities: string[]; maxRows: number }, token: string, env: Env): Response {
  // The browser authenticates exclusively with an HttpOnly cookie. Returning
  // the JWT in JSON would expose it to any successful script injection.
  const response = json({ user: publicUser(user) });
  response.headers.set("set-cookie", sessionCookie(token, env));
  return response;
}

export async function bootstrapStatus(_request: Request, env: Env): Promise<Response> {
  const count = await env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  return json({ bootstrapRequired: (count?.total ?? 0) === 0 });
}

export async function bootstrap(request: Request, env: Env): Promise<Response> {
  const body = objectBody(await readJson(request));
  const user = await bootstrapUser(env, validateEmail(body.email), validatePassword(body.password), body.bootstrapToken);
  return authResponse(user, await createSessionToken(user, env), env);
}

export async function login(request: Request, env: Env): Promise<Response> {
  const body = objectBody(await readJson(request));
  const email = validateEmail(body.email);
  const connectingIp = request.headers.get("cf-connecting-ip")?.trim() || "unknown";
  const [globalSubject, ipSubject, accountSubject] = await Promise.all([
    hashSubject("login:global"),
    hashSubject(`login:ip:${connectingIp}`),
    hashSubject(`login:account:${email}`),
  ]);
  const limit = Math.min(Math.max(Number(env.AUTH_LOGIN_ATTEMPTS_PER_15_MINUTES) || 20, 5), 100);
  // Evaluate the global bucket first so a distributed email spray stops
  // creating per-subject D1 writes after the workspace ceiling is reached.
  await consumeRateLimit(env.QUERYMIND_APP, globalSubject, 86_400, 2_000);
  await consumeRateLimit(env.QUERYMIND_APP, ipSubject, 900, Math.min(limit * 3, 200));
  await consumeRateLimit(env.QUERYMIND_APP, accountSubject, 900, limit);
  const user = await loginUser(env, email, validatePassword(body.password));
  return authResponse(user, await createSessionToken(user, env), env);
}

export async function currentUser(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  return json({ user: publicUser(user) });
}

export async function authStatus(request: Request, env: Env): Promise<Response> {
  const hasCredentials = request.headers.has("authorization") || request.headers.get("cookie")?.includes("qm_session=");
  if (!hasCredentials) return json({ user: null });
  return currentUser(request, env);
}

export function logout(env: Env): Response {
  const response = json({ ok: true });
  response.headers.set("set-cookie", expiredSessionCookie(env));
  return response;
}

export async function changePassword(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env); const body = objectBody(await readJson(request));
  const passwordUpdatedAt = await changePasswordForUser(env, user, validatePassword(body.currentPassword), validatePassword(body.newPassword));
  await audit(env, { actorId: user.id, eventType: "auth.password_changed", resourceType: "user", resourceId: user.id });
  const response = json({ ok: true, user: publicUser(user) });
  response.headers.set("set-cookie", sessionCookie(await createSessionToken({ ...user, passwordUpdatedAt }, env), env));
  return response;
}
