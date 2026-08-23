import { HttpError } from "./http";
import { MAX_SAFE_RESULT_ROWS } from "./product";

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const ACTIVE_PBKDF2_ITERATIONS = 10_000;
const LEGACY_PBKDF2_ITERATIONS = 100_000;
const ACTIVE_PASSWORD_ALGORITHM = "pbkdf2-sha256-10000-peppered-v1";

export interface AuthenticatedUser {
  id: string;
  email: string;
  displayName: string;
  roleName: string;
  capabilities: string[];
  maxRows: number;
  principalType?: "session" | "api_key" | "local";
  apiKeyPrefix?: string;
  /** Internal credential version used when issuing browser JWTs. */
  passwordUpdatedAt?: string | null;
  /** Optional deterministic data boundary. Blank values fall back to role:<role>. */
  scopeKey?: string;
}

interface TokenPayload { sub: string; email: string; exp: number; iat: number; pwd?: string | null; }

interface UserCredentialRow {
  id: string;
  email: string;
  display_name: string;
  password_salt: string | null;
  password_hash: string | null;
  password_algorithm: string | null;
  password_updated_at: string | null;
  role_name: string;
  is_active: number;
  data_scope_key?: string | null;
}

interface RoleRow { role_name: string; capabilities_json: string; max_rows_per_query: number; }

function base64UrlEncode(value: Uint8Array): string {
  let binary = "";
  for (const byte of value) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64UrlDecode(value: string): Uint8Array {
  const base64 = value.replaceAll("-", "+").replaceAll("_", "/") + "===".slice((value.length + 3) % 4);
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
}

function jsonBase64(value: unknown): string { return base64UrlEncode(encoder.encode(JSON.stringify(value))); }

function parseJsonBase64<T>(value: string): T | null {
  try { return JSON.parse(decoder.decode(base64UrlDecode(value))) as T; } catch { return null; }
}

function secureEqual(left: string, right: string): boolean {
  const leftBytes = encoder.encode(left);
  const rightBytes = encoder.encode(right);
  let difference = leftBytes.length ^ rightBytes.length;
  const length = Math.max(leftBytes.length, rightBytes.length);
  for (let index = 0; index < length; index += 1) difference |= (leftBytes[index] ?? 0) ^ (rightBytes[index] ?? 0);
  return difference === 0;
}

async function importHmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
}

async function signJwt(payload: TokenPayload, secret: string): Promise<string> {
  const head = jsonBase64({ alg: "HS256", typ: "JWT" });
  const body = jsonBase64(payload);
  const signedPart = `${head}.${body}`;
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(secret), encoder.encode(signedPart));
  return `${signedPart}.${base64UrlEncode(new Uint8Array(signature))}`;
}

async function verifyJwt(token: string, secret: string): Promise<TokenPayload | null> {
  const [head, body, signature, ...extra] = token.split(".");
  if (!head || !body || !signature || extra.length > 0) return null;
  const header = parseJsonBase64<{ alg?: string; typ?: string }>(head);
  const payload = parseJsonBase64<TokenPayload>(body);
  if (header?.alg !== "HS256" || header.typ !== "JWT" || !payload?.sub || !payload.email || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat)) return null;
  try {
    const verified = await crypto.subtle.verify("HMAC", await importHmacKey(secret), base64UrlDecode(signature), encoder.encode(`${head}.${body}`));
    return verified && payload.exp > Math.floor(Date.now() / 1000) ? payload : null;
  } catch { return null; }
}

async function derivePasswordHash(password: string, salt: string): Promise<string> {
  const baseKey = await crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64UrlDecode(salt), iterations: LEGACY_PBKDF2_ITERATIONS }, baseKey, 256);
  return base64UrlEncode(new Uint8Array(bits));
}

async function derivePepperedPasswordHash(password: string, salt: string, pepper: string): Promise<string> {
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(pepper), encoder.encode(`${salt}.${password}`));
  return base64UrlEncode(new Uint8Array(signature));
}

async function deriveSlowPepperedPasswordHash(password: string, salt: string, pepper: string, iterations = ACTIVE_PBKDF2_ITERATIONS): Promise<string> {
  // Pre-hash with the secret pepper, then apply the deliberately slow KDF. The
  // pepper never becomes part of the stored salt/hash record.
  const peppered = await crypto.subtle.sign("HMAC", await importHmacKey(pepper), encoder.encode(password));
  const baseKey = await crypto.subtle.importKey("raw", peppered, "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: base64UrlDecode(salt), iterations }, baseKey, 256);
  return base64UrlEncode(new Uint8Array(bits));
}

export async function hashOpaqueSecret(value: string, env: Env): Promise<string> {
  if (!env.AUTH_PASSWORD_PEPPER) throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Authentication secret is not configured.");
  const signature = await crypto.subtle.sign("HMAC", await importHmacKey(env.AUTH_PASSWORD_PEPPER), encoder.encode(value));
  return base64UrlEncode(new Uint8Array(signature));
}

export function validateEmail(value: unknown): string {
  if (typeof value !== "string") throw new HttpError(400, "INVALID_EMAIL", "email must be a string.");
  const email = value.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email) || email.length > 254) throw new HttpError(400, "INVALID_EMAIL", "email must be a valid email address.");
  return email;
}

export function validatePassword(value: unknown): string {
  if (typeof value !== "string" || value.length < 12 || value.length > 256) throw new HttpError(400, "INVALID_PASSWORD", "password must contain 12 to 256 characters.");
  return value;
}

export async function createPasswordRecord(password: string, env: Env): Promise<{ salt: string; hash: string; algorithm: string }> {
  if (!env.AUTH_PASSWORD_PEPPER) throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Password pepper is not configured.");
  const salt = base64UrlEncode(crypto.getRandomValues(new Uint8Array(16)));
  return { salt, hash: await deriveSlowPepperedPasswordHash(password, salt, env.AUTH_PASSWORD_PEPPER), algorithm: ACTIVE_PASSWORD_ALGORITHM };
}

export async function passwordMatches(password: string, salt: string, expectedHash: string, algorithm: string, env: Env): Promise<boolean> {
  let actual: string;
  if ((algorithm === ACTIVE_PASSWORD_ALGORITHM || algorithm === "pbkdf2-sha256-100000-peppered-v1" || algorithm === "hmac-sha256-v1") && !env.AUTH_PASSWORD_PEPPER) {
    throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Password pepper is not configured.");
  }
  if (algorithm === ACTIVE_PASSWORD_ALGORITHM) actual = await deriveSlowPepperedPasswordHash(password, salt, env.AUTH_PASSWORD_PEPPER);
  else if (algorithm === "pbkdf2-sha256-100000-peppered-v1") actual = await deriveSlowPepperedPasswordHash(password, salt, env.AUTH_PASSWORD_PEPPER, LEGACY_PBKDF2_ITERATIONS);
  else if (algorithm === "hmac-sha256-v1") actual = await derivePepperedPasswordHash(password, salt, env.AUTH_PASSWORD_PEPPER);
  else if (algorithm === "pbkdf2-sha256-100000") actual = await derivePasswordHash(password, salt);
  else return false;
  return secureEqual(actual, expectedHash);
}

function parseCapabilities(value: string): string[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : [];
  } catch { return []; }
}

async function roleFor(env: Env, roleName: string): Promise<Pick<AuthenticatedUser, "roleName" | "capabilities" | "maxRows">> {
  const role = await env.QUERYMIND_APP.prepare("SELECT role_name, capabilities_json, max_rows_per_query FROM role_definitions WHERE role_name = ?").bind(roleName).first<RoleRow>();
  if (!role) return { roleName: "viewer", capabilities: ["chat", "view_schema", "view_dictionary", "view_templates", "manage_own_sessions", "manage_own_insights", "view_own_usage"], maxRows: 1000 };
  return { roleName: role.role_name, capabilities: parseCapabilities(role.capabilities_json), maxRows: Math.min(Math.max(role.max_rows_per_query, 1), MAX_SAFE_RESULT_ROWS) };
}

async function userFor(
  env: Env,
  row: Pick<UserCredentialRow, "id" | "email" | "display_name" | "role_name" | "is_active"> & Partial<Pick<UserCredentialRow, "password_updated_at" | "data_scope_key">>,
  apiKeyPrefix?: string,
): Promise<AuthenticatedUser> {
  if (row.is_active !== 1) throw new HttpError(403, "ACCOUNT_DISABLED", "This account has been deactivated.");
  return {
    id: row.id,
    email: row.email,
    displayName: row.display_name,
    ...(await roleFor(env, row.role_name)),
    principalType: apiKeyPrefix ? "api_key" : "session",
    ...(apiKeyPrefix ? { apiKeyPrefix } : {}),
    ...(row.password_updated_at !== undefined ? { passwordUpdatedAt: row.password_updated_at } : {}),
    scopeKey: row.data_scope_key?.trim() || `role:${row.role_name}`,
  };
}

export function hasCapability(user: AuthenticatedUser, capability: string): boolean { return user.capabilities.includes("*") || user.capabilities.includes(capability); }

export function requireCapability(user: AuthenticatedUser, capability: string): void {
  if (!hasCapability(user, capability)) throw new HttpError(403, "RBAC_FORBIDDEN", "Your role is not allowed to use this feature.");
}

export function requireBrowserSession(user: AuthenticatedUser): void {
  if (user.principalType === "api_key" || user.apiKeyPrefix) {
    throw new HttpError(403, "API_KEY_RESTRICTED", "This security-sensitive action requires a browser session.");
  }
}

export async function createSessionToken(user: AuthenticatedUser, env: Env): Promise<string> {
  if (!env.AUTH_JWT_SECRET) throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Authentication secret is not configured.");
  // Browser login/bootstrap callers carry the exact credential version that
  // was verified or created. This prevents a concurrent password reset from
  // accidentally granting a new-version token to an old password.
  const credential = user.passwordUpdatedAt === undefined
    ? await env.QUERYMIND_APP.prepare("SELECT password_updated_at FROM users WHERE id = ? AND email = ? AND is_active = 1").bind(user.id, user.email).first<{ password_updated_at: string | null }>()
    : { password_updated_at: user.passwordUpdatedAt };
  if (!credential) throw new HttpError(401, "INVALID_SESSION", "Session user no longer exists.");
  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(Math.max(Number(env.AUTH_TOKEN_TTL_SECONDS) || 28_800, 900), 86_400);
  return signJwt({ sub: user.id, email: user.email, pwd: credential.password_updated_at, iat: now, exp: now + ttl }, env.AUTH_JWT_SECRET);
}

function tokenFromRequest(request: Request): string | null {
  const authorization = request.headers.get("authorization");
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length).trim();
  const match = (request.headers.get("cookie") ?? "").match(/(?:^|;\s*)qm_session=([^;]+)/u);
  return match?.[1] ?? null;
}

async function apiKeyUser(token: string, env: Env): Promise<AuthenticatedUser | null> {
  if (!token.startsWith("qm_")) return null;
  const keyHash = await hashOpaqueSecret(token, env);
  const row = await env.QUERYMIND_APP.prepare(
    "SELECT u.id, u.email, u.display_name, u.role_name, u.is_active, u.data_scope_key, k.key_prefix FROM api_keys k JOIN users u ON u.id = k.user_id WHERE k.key_hash = ? AND k.revoked_at IS NULL",
  ).bind(keyHash).first<Pick<UserCredentialRow, "id" | "email" | "display_name" | "role_name" | "is_active" | "data_scope_key"> & { key_prefix: string }>();
  if (!row) return null;
  const now = new Date().toISOString();
  await env.QUERYMIND_APP.prepare("UPDATE api_keys SET last_used_at = ? WHERE key_hash = ?").bind(now, keyHash).run();
  return userFor(env, row, row.key_prefix);
}

export async function requireUser(request: Request, env: Env): Promise<AuthenticatedUser> {
  if (env.ENVIRONMENT === "production" && env.AUTH_REQUIRED !== "true") throw new HttpError(503, "AUTH_REQUIRED_CONFIG", "Production authentication must be enabled.");
  if (env.AUTH_REQUIRED !== "true") return { id: "local-anonymous", email: "local@querymind.invalid", displayName: "Local user", roleName: "owner", capabilities: ["*"], maxRows: MAX_SAFE_RESULT_ROWS, principalType: "local", scopeKey: "role:owner" };
  if (!env.AUTH_JWT_SECRET) throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Authentication is not configured.");
  const token = tokenFromRequest(request);
  if (!token) throw new HttpError(401, "AUTH_REQUIRED", "Authentication is required.");
  const viaKey = await apiKeyUser(token, env);
  if (viaKey) return viaKey;
  const payload = await verifyJwt(token, env.AUTH_JWT_SECRET);
  if (!payload) throw new HttpError(401, "INVALID_SESSION", "Session is invalid or expired.");
  const user = await env.QUERYMIND_APP.prepare("SELECT id, email, display_name, role_name, is_active, password_updated_at, data_scope_key FROM users WHERE id = ? AND email = ?").bind(payload.sub, payload.email).first<Pick<UserCredentialRow, "id" | "email" | "display_name" | "role_name" | "is_active" | "password_updated_at" | "data_scope_key">>();
  if (!user) throw new HttpError(401, "INVALID_SESSION", "Session user no longer exists.");
  if (payload.pwd === undefined || payload.pwd !== user.password_updated_at) throw new HttpError(401, "INVALID_SESSION", "Session was invalidated by a password change.");
  return userFor(env, user);
}

export function sessionCookie(token: string, env: Env): string {
  const ttl = Math.min(Math.max(Number(env.AUTH_TOKEN_TTL_SECONDS) || 28_800, 900), 86_400);
  return `qm_session=${token}; HttpOnly;${env.ENVIRONMENT === "local" ? "" : " Secure;"} SameSite=Strict; Path=/; Max-Age=${ttl}`;
}

export function expiredSessionCookie(env: Env): string { return `qm_session=; HttpOnly;${env.ENVIRONMENT === "local" ? "" : " Secure;"} SameSite=Strict; Path=/; Max-Age=0`; }

export async function bootstrapUser(env: Env, email: string, password: string, bootstrapToken: unknown): Promise<AuthenticatedUser> {
  if (!env.AUTH_BOOTSTRAP_TOKEN) throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Bootstrap secret is not configured.");
  if (typeof bootstrapToken !== "string" || !secureEqual(bootstrapToken, env.AUTH_BOOTSTRAP_TOKEN)) throw new HttpError(401, "INVALID_BOOTSTRAP_TOKEN", "Bootstrap token is invalid.");
  const count = await env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>();
  if ((count?.total ?? 0) > 0) throw new HttpError(409, "BOOTSTRAP_ALREADY_COMPLETE", "An initial user already exists.");
  const credential = await createPasswordRecord(password, env);
  const now = new Date().toISOString();
  const row: Pick<UserCredentialRow, "id" | "email" | "display_name" | "role_name" | "is_active" | "password_updated_at" | "data_scope_key"> = { id: crypto.randomUUID(), email, display_name: email.split("@")[0] ?? email, role_name: "owner", is_active: 1, password_updated_at: now, data_scope_key: null };
  const inserted = await env.QUERYMIND_APP.prepare(
    "INSERT INTO users (id, email, display_name, password_salt, password_hash, password_algorithm, password_updated_at, role_name, is_active, updated_at, created_at, last_seen_at) SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM users)",
  ).bind(row.id, row.email, row.display_name, credential.salt, credential.hash, credential.algorithm, now, row.role_name, row.is_active, now, now, now).run();
  if (!inserted.meta.changes) throw new HttpError(409, "BOOTSTRAP_ALREADY_COMPLETE", "An initial user already exists.");
  return userFor(env, row);
}

export async function loginUser(env: Env, email: string, password: string): Promise<AuthenticatedUser> {
  const row = await env.QUERYMIND_APP.prepare("SELECT id, email, display_name, password_salt, password_hash, password_algorithm, password_updated_at, role_name, is_active, data_scope_key FROM users WHERE email = ?").bind(email).first<UserCredentialRow>();
  const algorithm = row?.password_algorithm ?? "pbkdf2-sha256-100000";
  if (!row?.password_salt || !row.password_hash || !(await passwordMatches(password, row.password_salt, row.password_hash, algorithm, env))) throw new HttpError(401, "INVALID_CREDENTIALS", "Email or password is incorrect.");
  if (row.is_active !== 1) throw new HttpError(403, "ACCOUNT_DISABLED", "This account has been deactivated.");
  const now = new Date().toISOString();
  if (algorithm !== ACTIVE_PASSWORD_ALGORITHM) {
    const upgraded = await createPasswordRecord(password, env);
    const result = await env.QUERYMIND_APP.prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_algorithm = ?, password_updated_at = ?, last_seen_at = ?, updated_at = ? WHERE id = ? AND password_hash = ? AND password_updated_at IS ?").bind(upgraded.salt, upgraded.hash, upgraded.algorithm, now, now, now, row.id, row.password_hash, row.password_updated_at).run();
    if (!result.meta.changes) throw new HttpError(401, "INVALID_CREDENTIALS", "Credentials changed while login was in progress. Please try again.");
    row.password_updated_at = now;
  } else await env.QUERYMIND_APP.prepare("UPDATE users SET last_seen_at = ? WHERE id = ?").bind(now, row.id).run();
  return userFor(env, row);
}

export async function changePasswordForUser(env: Env, user: AuthenticatedUser, currentPassword: string, nextPassword: string): Promise<string> {
  requireBrowserSession(user);
  const row = await env.QUERYMIND_APP.prepare("SELECT password_salt, password_hash, password_algorithm, password_updated_at FROM users WHERE id = ? AND is_active = 1").bind(user.id).first<{ password_salt: string | null; password_hash: string | null; password_algorithm: string | null; password_updated_at: string | null }>();
  if (!row?.password_salt || !row.password_hash || !(await passwordMatches(currentPassword, row.password_salt, row.password_hash, row.password_algorithm ?? "pbkdf2-sha256-100000", env))) throw new HttpError(401, "INVALID_CREDENTIALS", "Current password is incorrect.");
  const credential = await createPasswordRecord(nextPassword, env);
  const previousTimestamp = row.password_updated_at ? Date.parse(row.password_updated_at) : 0;
  const now = new Date(Math.max(Date.now(), Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0)).toISOString();
  const updated = await env.QUERYMIND_APP.prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_algorithm = ?, password_updated_at = ?, updated_at = ? WHERE id = ? AND password_hash = ? AND password_updated_at IS ?").bind(credential.salt, credential.hash, credential.algorithm, now, now, user.id, row.password_hash, row.password_updated_at).run();
  if (!updated.meta.changes) throw new HttpError(409, "CREDENTIAL_CHANGED", "Credentials changed while the request was in progress. Please sign in again.");
  return now;
}
