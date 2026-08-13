import { audit } from "../lib/audit";
import { gatewayConfigured } from "../lib/ai-config";
import { createPasswordRecord, hashOpaqueSecret, requireBrowserSession, requireCapability, requireUser, validateEmail, validatePassword } from "../lib/auth";
import { HttpError, json, readJson } from "../lib/http";
import { booleanValue, isProductCapability, MAX_SAFE_RESULT_ROWS, objectBody, optionalText, page, requiredText, roleName } from "../lib/product";
import { assertNoSensitiveInference, maskedQueryRows } from "../lib/dlp";
import { consumeRateLimit, hashSubject } from "../lib/rate-limit";
import { MAX_API_RESULT_BYTES } from "../lib/result-budget";
import { validateReadOnlySql } from "../lib/sql";

type UserRow = { id: string; email: string; display_name: string; role_name: string; is_active: number; created_at: string; last_seen_at: string | null };
type RoleRow = { role_name: string; display_name: string; description: string; capabilities_json: string; max_rows_per_query: number; is_system: number; updated_at: string };

function parseJson(value: string): unknown[] { try { const parsed = JSON.parse(value) as unknown; return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function publicUser(row: UserRow): Record<string, unknown> { return { id: row.id, email: row.email, displayName: row.display_name, roleName: row.role_name, isActive: row.is_active === 1, createdAt: row.created_at, lastSeenAt: row.last_seen_at }; }
export function publicRole(row: RoleRow): Record<string, unknown> { return { roleName: row.role_name, displayName: row.display_name, description: row.description, capabilities: parseJson(row.capabilities_json), maxRowsPerQuery: Math.min(Math.max(row.max_rows_per_query, 1), MAX_SAFE_RESULT_ROWS), isSystem: row.is_system === 1, updatedAt: row.updated_at }; }
export function csvCell(value: unknown): string {
  const text = value == null ? "" : String(value);
  const safe = /^[\p{Z}\p{Cc}\p{Cf}]*[=+\-@]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

async function owner(request: Request, env: Env) { const user = await requireUser(request, env); requireBrowserSession(user); requireCapability(user, "manage_users"); return user; }

export async function dashboard(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const [sessions, insights, usage] = await Promise.all([
    env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM chat_sessions WHERE user_id = ? AND archived = 0").bind(user.id).first<{ total: number }>(),
    env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM insights WHERE user_id = ?").bind(user.id).first<{ total: number }>(),
    env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total, COALESCE(SUM(row_count), 0) AS rows FROM ai_usage_events WHERE user_id = ? AND created_at >= ?").bind(user.id, since).first<{ total: number; rows: number }>(),
  ]);
  const recent = (await env.QUERYMIND_APP.prepare("SELECT event_type, resource_type, created_at FROM audit_events WHERE actor_id = ? ORDER BY created_at DESC LIMIT 8").bind(user.id).all<{ event_type: string; resource_type: string | null; created_at: string }>()).results ?? [];
  return json({ user: { roleName: user.roleName, maxRows: user.maxRows }, summary: { sessions: sessions?.total ?? 0, insights: insights?.total ?? 0, requestsLast30Days: usage?.total ?? 0, resultRowsLast30Days: usage?.rows ?? 0 }, recent });
}

export async function listTemplates(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env); requireCapability(user, "view_templates");
  const result = await env.QUERYMIND_APP.prepare("SELECT id, title, prompt, category, description, is_pinned, is_shared, created_by, created_at, updated_at FROM query_templates WHERE is_shared = 1 OR created_by = ? ORDER BY is_pinned DESC, updated_at DESC").bind(user.id).all<Record<string, unknown>>();
  return json({ templates: result.results ?? [] });
}

export async function createTemplate(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env); requireCapability(user, "manage_templates"); const body = objectBody(await readJson(request));
  const now = new Date().toISOString(); const id = crypto.randomUUID(); const isShared = booleanValue(body.isShared, "isShared") ?? false;
  const item = { id, title: requiredText(body.title, "title", 120), prompt: requiredText(body.prompt, "prompt", 4000), category: optionalText(body.category, "category", 80) ?? "", description: optionalText(body.description, "description", 500) ?? "", isPinned: booleanValue(body.isPinned, "isPinned") ?? false, isShared, createdBy: user.id, createdAt: now, updatedAt: now };
  await env.QUERYMIND_APP.prepare("INSERT INTO query_templates (id, title, prompt, category, description, is_pinned, is_shared, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(id, item.title, item.prompt, item.category, item.description, Number(item.isPinned), Number(isShared), user.id, now, now).run();
  await audit(env, { actorId: user.id, eventType: "template.created", resourceType: "template", resourceId: id }); return json({ template: item }, 201);
}

export async function updateTemplate(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env); requireCapability(user, "manage_templates"); const current = await env.QUERYMIND_APP.prepare("SELECT id, created_by FROM query_templates WHERE id = ?").bind(id).first<{ id: string; created_by: string | null }>();
  if (!current) throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Template was not found."); if (current.created_by && current.created_by !== user.id && user.roleName !== "owner") throw new HttpError(403, "RBAC_FORBIDDEN", "Only the template owner or Owner may change it.");
  const body = objectBody(await readJson(request)); const title = optionalText(body.title, "title", 120); const prompt = optionalText(body.prompt, "prompt", 4000); const category = optionalText(body.category, "category", 80); const description = optionalText(body.description, "description", 500); const pinned = booleanValue(body.isPinned, "isPinned"); const shared = booleanValue(body.isShared, "isShared");
  if ([title, prompt, category, description, pinned, shared].every((value) => value === undefined)) throw new HttpError(400, "INVALID_REQUEST", "At least one editable field is required.");
  const existing = await env.QUERYMIND_APP.prepare("SELECT title, prompt, category, description, is_pinned, is_shared FROM query_templates WHERE id = ?").bind(id).first<{ title: string; prompt: string; category: string; description: string; is_pinned: number; is_shared: number }>(); const now = new Date().toISOString();
  await env.QUERYMIND_APP.prepare("UPDATE query_templates SET title = ?, prompt = ?, category = ?, description = ?, is_pinned = ?, is_shared = ?, updated_at = ? WHERE id = ?").bind(title ?? existing!.title, prompt ?? existing!.prompt, category ?? existing!.category, description ?? existing!.description, pinned === undefined ? existing!.is_pinned : Number(pinned), shared === undefined ? existing!.is_shared : Number(shared), now, id).run();
  await audit(env, { actorId: user.id, eventType: "template.updated", resourceType: "template", resourceId: id }); return json({ ok: true });
}

export async function deleteTemplate(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env); requireCapability(user, "manage_templates"); const row = await env.QUERYMIND_APP.prepare("SELECT created_by FROM query_templates WHERE id = ?").bind(id).first<{ created_by: string | null }>();
  if (!row) throw new HttpError(404, "TEMPLATE_NOT_FOUND", "Template was not found."); if (row.created_by && row.created_by !== user.id && user.roleName !== "owner") throw new HttpError(403, "RBAC_FORBIDDEN", "Only the template owner or Owner may remove it."); await env.QUERYMIND_APP.prepare("DELETE FROM query_templates WHERE id = ?").bind(id).run(); await audit(env, { actorId: user.id, eventType: "template.deleted", resourceType: "template", resourceId: id }); return json({ ok: true });
}

export async function listInsights(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env); requireCapability(user, "manage_own_insights"); const result = await env.QUERYMIND_APP.prepare("SELECT id, title, description, prompt, sql_text AS sql, chart_type AS chartType, is_favorite AS isFavorite, created_at AS createdAt, updated_at AS updatedAt FROM insights WHERE user_id = ? ORDER BY is_favorite DESC, updated_at DESC").bind(user.id).all(); return json({ insights: result.results ?? [] });
}

export async function createInsight(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env); requireCapability(user, "manage_own_insights"); const body = objectBody(await readJson(request)); const chartType = ["table", "bar", "line", "area"].includes(String(body.chartType)) ? String(body.chartType) : "table"; const now = new Date().toISOString(); const insight = { id: crypto.randomUUID(), title: requiredText(body.title, "title", 120), description: optionalText(body.description, "description", 500) ?? "", prompt: optionalText(body.prompt, "prompt", 4000) ?? "", sql: optionalText(body.sql, "sql", 10_000) ?? null, chartType, isFavorite: booleanValue(body.isFavorite, "isFavorite") ?? false, createdAt: now, updatedAt: now };
  if (insight.sql) validateReadOnlySql(insight.sql, user.maxRows); await env.QUERYMIND_APP.prepare("INSERT INTO insights (id, user_id, title, description, prompt, sql_text, chart_type, is_favorite, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)").bind(insight.id, user.id, insight.title, insight.description, insight.prompt, insight.sql, insight.chartType, Number(insight.isFavorite), now, now).run(); await audit(env, { actorId: user.id, eventType: "insight.created", resourceType: "insight", resourceId: insight.id }); return json({ insight }, 201);
}

export async function updateInsight(request: Request, env: Env, id: string): Promise<Response> {
  const user = await requireUser(request, env); requireCapability(user, "manage_own_insights"); const body = objectBody(await readJson(request)); const previous = await env.QUERYMIND_APP.prepare("SELECT title, description, prompt, sql_text, chart_type, is_favorite FROM insights WHERE id = ? AND user_id = ?").bind(id, user.id).first<{ title: string; description: string; prompt: string; sql_text: string | null; chart_type: string; is_favorite: number }>(); if (!previous) throw new HttpError(404, "INSIGHT_NOT_FOUND", "Insight was not found."); const title = optionalText(body.title, "title", 120) ?? previous.title; const description = optionalText(body.description, "description", 500) ?? previous.description; const prompt = optionalText(body.prompt, "prompt", 4000) ?? previous.prompt; const sql = optionalText(body.sql, "sql", 10_000) ?? previous.sql_text; const chartType = body.chartType === undefined ? previous.chart_type : ["table", "bar", "line", "area"].includes(String(body.chartType)) ? String(body.chartType) : (() => { throw new HttpError(400, "INVALID_REQUEST", "chartType is invalid."); })(); const favorite = booleanValue(body.isFavorite, "isFavorite") ?? Boolean(previous.is_favorite); if (sql) validateReadOnlySql(sql, user.maxRows); const now = new Date().toISOString(); await env.QUERYMIND_APP.prepare("UPDATE insights SET title = ?, description = ?, prompt = ?, sql_text = ?, chart_type = ?, is_favorite = ?, updated_at = ? WHERE id = ? AND user_id = ?").bind(title, description, prompt, sql, chartType, Number(favorite), now, id, user.id).run(); await audit(env, { actorId: user.id, eventType: "insight.updated", resourceType: "insight", resourceId: id }); return json({ ok: true });
}

export async function deleteInsight(request: Request, env: Env, id: string): Promise<Response> { const user = await requireUser(request, env); requireCapability(user, "manage_own_insights"); const result = await env.QUERYMIND_APP.prepare("DELETE FROM insights WHERE id = ? AND user_id = ?").bind(id, user.id).run(); if (!result.meta.changes) throw new HttpError(404, "INSIGHT_NOT_FOUND", "Insight was not found."); await audit(env, { actorId: user.id, eventType: "insight.deleted", resourceType: "insight", resourceId: id }); return json({ ok: true }); }

export async function listDictionary(request: Request, env: Env): Promise<Response> { const user = await requireUser(request, env); requireCapability(user, "view_dictionary"); const result = await env.QUERYMIND_APP.prepare("SELECT id, term, definition, category, examples, updated_at AS updatedAt FROM dictionary_entries ORDER BY category, term").all(); return json({ entries: result.results ?? [] }); }

export async function saveDictionary(request: Request, env: Env, id?: string): Promise<Response> {
  const user = await requireUser(request, env); requireCapability(user, "manage_dictionary"); const body = objectBody(await readJson(request)); const entryId = id ?? crypto.randomUUID(); const now = new Date().toISOString(); const term = requiredText(body.term, "term", 120); const definition = requiredText(body.definition, "definition", 2000); const category = optionalText(body.category, "category", 80) ?? "business"; const examples = optionalText(body.examples, "examples", 1000) ?? "";
  if (id) { const exists = await env.QUERYMIND_APP.prepare("SELECT id FROM dictionary_entries WHERE id = ?").bind(id).first(); if (!exists) throw new HttpError(404, "DICTIONARY_NOT_FOUND", "Dictionary entry was not found."); await env.QUERYMIND_APP.prepare("UPDATE dictionary_entries SET term = ?, definition = ?, category = ?, examples = ?, updated_by = ?, updated_at = ? WHERE id = ?").bind(term, definition, category, examples, user.id, now, id).run(); } else await env.QUERYMIND_APP.prepare("INSERT INTO dictionary_entries (id, term, definition, category, examples, updated_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(entryId, term, definition, category, examples, user.id, now, now).run();
  await audit(env, { actorId: user.id, eventType: `dictionary.${id ? "updated" : "created"}`, resourceType: "dictionary", resourceId: entryId }); return json({ id: entryId }, id ? 200 : 201);
}

export async function deleteDictionary(request: Request, env: Env, id: string): Promise<Response> { const user = await requireUser(request, env); requireCapability(user, "manage_dictionary"); const result = await env.QUERYMIND_APP.prepare("DELETE FROM dictionary_entries WHERE id = ?").bind(id).run(); if (!result.meta.changes) throw new HttpError(404, "DICTIONARY_NOT_FOUND", "Dictionary entry was not found."); await audit(env, { actorId: user.id, eventType: "dictionary.deleted", resourceType: "dictionary", resourceId: id }); return json({ ok: true }); }

export async function exportCsv(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "export");
  const [userSubject, globalSubject] = await Promise.all([
    hashSubject(`export:${user.id}`),
    hashSubject("export:global"),
  ]);
  await consumeRateLimit(env.QUERYMIND_APP, userSubject, 3_600, 5);
  await consumeRateLimit(env.QUERYMIND_APP, globalSubject, 86_400, 20);

  const body = objectBody(await readJson(request));
  const validated = validateReadOnlySql(body.sql, user.maxRows);
  await assertNoSensitiveInference(env, validated.originalSql);
  const result = await env.QUERYMIND_DATA.prepare(validated.executionSql).all<Record<string, unknown>>();
  const masked = await maskedQueryRows(env, result.results ?? [], validated.originalSql);
  const rows = masked.rows;
  const columnSet = new Set<string>();
  for (const row of rows) for (const column of Object.keys(row)) columnSet.add(column);
  const columns = [...columnSet];
  const line = (row: Record<string, unknown>): string => columns.map((column) => csvCell(row[column])).join(",");
  const encoder = new TextEncoder();
  const header = columns.map(csvCell).join(",");
  let responseBytes = encoder.encode(`\uFEFF${header}`).byteLength;
  for (const row of rows) {
    responseBytes += encoder.encode(`\r\n${line(row)}`).byteLength;
    if (responseBytes > MAX_API_RESULT_BYTES) throw new HttpError(413, "RESULT_TOO_LARGE", "CSV export exceeds the 2 MB safe response size. Add filters or select fewer columns.");
  }

  let rowIndex = 0;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) { controller.enqueue(encoder.encode(`\uFEFF${header}`)); },
    pull(controller) {
      if (rowIndex >= rows.length) {
        controller.close();
        return;
      }
      controller.enqueue(encoder.encode(`\r\n${line(rows[rowIndex])}`));
      rowIndex += 1;
    },
  });
  await audit(env, { actorId: user.id, eventType: "export.csv", resourceType: "query", metadata: { rowCount: rows.length, responseBytes, maskedColumns: masked.maskedColumns } });
  return new Response(stream, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": "attachment; filename=querymind-export.csv", "content-length": String(responseBytes), "cache-control": "no-store" } });
}

export async function listUsers(request: Request, env: Env): Promise<Response> { await owner(request, env); const result = await env.QUERYMIND_APP.prepare("SELECT id, email, display_name, role_name, is_active, created_at, last_seen_at FROM users ORDER BY created_at ASC").all<UserRow>(); return json({ users: (result.results ?? []).map(publicUser) }); }

export async function updateUser(request: Request, env: Env, id: string): Promise<Response> { const actor = await owner(request, env); const body = objectBody(await readJson(request)); const target = await env.QUERYMIND_APP.prepare("SELECT id, email, display_name, role_name, is_active, created_at, last_seen_at FROM users WHERE id = ?").bind(id).first<UserRow>(); if (!target) throw new HttpError(404, "USER_NOT_FOUND", "User was not found."); const nextRole = body.roleName === undefined ? target.role_name : roleName(body.roleName); const nextActive = booleanValue(body.isActive, "isActive") ?? Boolean(target.is_active); if (target.id === actor.id && (!nextActive || nextRole !== "owner")) throw new HttpError(400, "OWNER_PROTECTION", "You cannot remove your own Owner access."); const removingActiveOwner = target.role_name === "owner" && target.is_active === 1 && (nextRole !== "owner" || !nextActive); const now = new Date().toISOString(); const result = await env.QUERYMIND_APP.prepare(`UPDATE users SET role_name = ?, is_active = ?, updated_at = ? WHERE id = ?${removingActiveOwner ? " AND EXISTS (SELECT 1 FROM users AS other WHERE other.id <> users.id AND other.role_name = 'owner' AND other.is_active = 1)" : ""}`).bind(nextRole, Number(nextActive), now, id).run(); if (!result.meta.changes) throw new HttpError(400, "OWNER_PROTECTION", "At least one active Owner is required."); await audit(env, { actorId: actor.id, eventType: "user.updated", resourceType: "user", resourceId: id, metadata: { roleName: nextRole, isActive: nextActive } }); return json({ user: publicUser({ ...target, role_name: nextRole, is_active: Number(nextActive) }) }); }

export async function resetUserPassword(request: Request, env: Env, id: string): Promise<Response> {
  const actor = await owner(request, env);
  if (actor.id === id) throw new HttpError(400, "OWNER_PROTECTION", "Use your profile password form to change your own password.");
  const target = await env.QUERYMIND_APP.prepare("SELECT id, password_updated_at FROM users WHERE id = ?").bind(id).first<{ id: string; password_updated_at: string | null }>();
  if (!target) throw new HttpError(404, "USER_NOT_FOUND", "User was not found.");
  const temporaryPassword = `Qm!${base64Url(crypto.getRandomValues(new Uint8Array(24)))}`;
  validatePassword(temporaryPassword);
  const credential = await createPasswordRecord(temporaryPassword, env);
  const previousTimestamp = target.password_updated_at ? Date.parse(target.password_updated_at) : 0;
  const passwordUpdatedAt = new Date(Math.max(Date.now(), Number.isFinite(previousTimestamp) ? previousTimestamp + 1 : 0)).toISOString();
  await env.QUERYMIND_APP.batch([
    env.QUERYMIND_APP.prepare("UPDATE users SET password_salt = ?, password_hash = ?, password_algorithm = ?, password_updated_at = ?, updated_at = ? WHERE id = ?").bind(credential.salt, credential.hash, credential.algorithm, passwordUpdatedAt, passwordUpdatedAt, id),
    env.QUERYMIND_APP.prepare("INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, 'auth.password_reset_by_owner', 'user', ?, '{}', ?)").bind(crypto.randomUUID(), actor.id, id, passwordUpdatedAt),
  ]);
  return json({
    userId: id,
    temporaryPassword,
    passwordUpdatedAt,
    warning: "暫時密碼只會顯示這一次，請透過安全管道交付並要求使用者登入後立即變更。",
  });
}

export async function listRoles(request: Request, env: Env): Promise<Response> { await owner(request, env); const result = await env.QUERYMIND_APP.prepare("SELECT role_name, display_name, description, capabilities_json, max_rows_per_query, is_system, updated_at FROM role_definitions ORDER BY CASE role_name WHEN 'viewer' THEN 1 WHEN 'analyst' THEN 2 WHEN 'editor' THEN 3 WHEN 'dba' THEN 4 ELSE 5 END").all<RoleRow>(); return json({ roles: (result.results ?? []).map(publicRole) }); }

export async function updateRole(request: Request, env: Env, name: string): Promise<Response> { const actor = await owner(request, env); const body = objectBody(await readJson(request)); const role = roleName(name); const existing = await env.QUERYMIND_APP.prepare("SELECT role_name, display_name, description, capabilities_json, max_rows_per_query, is_system, updated_at FROM role_definitions WHERE role_name = ?").bind(role).first<RoleRow>(); if (!existing) throw new HttpError(404, "ROLE_NOT_FOUND", "Role was not found."); let capabilities = existing.capabilities_json; if (body.capabilities !== undefined) { if (!Array.isArray(body.capabilities) || !body.capabilities.every((item) => typeof item === "string") || body.capabilities.length > 40 || !body.capabilities.every((item) => item === "*" || isProductCapability(item))) throw new HttpError(400, "INVALID_CAPABILITIES", "capabilities must contain supported product capabilities."); capabilities = JSON.stringify([...new Set(body.capabilities)]); } if (role === "owner" && !parseJson(capabilities).includes("*")) throw new HttpError(400, "OWNER_PROTECTION", "Owner must retain all management capabilities."); if (role !== "owner" && parseJson(capabilities).includes("*")) throw new HttpError(400, "INVALID_CAPABILITIES", "Only Owner may use the all-capabilities marker."); const maxRows = body.maxRowsPerQuery === undefined ? Math.min(Math.max(existing.max_rows_per_query, 1), MAX_SAFE_RESULT_ROWS) : Number(body.maxRowsPerQuery); if (!Number.isInteger(maxRows) || maxRows < 1 || maxRows > MAX_SAFE_RESULT_ROWS) throw new HttpError(400, "INVALID_ROW_LIMIT", `maxRowsPerQuery must be between 1 and ${MAX_SAFE_RESULT_ROWS}.`); const displayName = optionalText(body.displayName, "displayName", 80) ?? existing.display_name; const description = optionalText(body.description, "description", 500) ?? existing.description; const now = new Date().toISOString(); await env.QUERYMIND_APP.prepare("UPDATE role_definitions SET display_name = ?, description = ?, capabilities_json = ?, max_rows_per_query = ?, updated_at = ? WHERE role_name = ?").bind(displayName, description, capabilities, maxRows, now, role).run(); await audit(env, { actorId: actor.id, eventType: "role.updated", resourceType: "role", resourceId: role }); return json({ ok: true }); }

function randomToken(prefix: string): string { const bytes = crypto.getRandomValues(new Uint8Array(24)); return `${prefix}${base64Url(bytes)}`; }
function base64Url(bytes: Uint8Array): string { let binary = ""; for (const byte of bytes) binary += String.fromCharCode(byte); return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, ""); }

export async function listInvitations(request: Request, env: Env): Promise<Response> { await owner(request, env); const result = await env.QUERYMIND_APP.prepare("SELECT i.id, i.email, i.role_name AS roleName, i.expires_at AS expiresAt, i.accepted_at AS acceptedAt, i.revoked_at AS revokedAt, i.created_at AS createdAt, u.email AS invitedByEmail FROM invitations i JOIN users u ON u.id = i.invited_by ORDER BY i.created_at DESC").all(); return json({ invitations: result.results ?? [] }); }
export async function createInvitation(request: Request, env: Env): Promise<Response> { const actor = await owner(request, env); const body = objectBody(await readJson(request)); const expiresHours = Math.min(Math.max(Number(body.expiresHours) || 72, 1), 720); const token = randomToken("qmi_"); const id = crypto.randomUUID(); const now = new Date(); const expiresAt = new Date(now.getTime() + expiresHours * 3_600_000).toISOString(); const email = validateEmail(body.email); const invitedRole = roleName(body.roleName ?? "viewer"); await env.QUERYMIND_APP.prepare("INSERT INTO invitations (id, email, role_name, token_hash, invited_by, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)").bind(id, email, invitedRole, await hashOpaqueSecret(token, env), actor.id, expiresAt, now.toISOString()).run(); await audit(env, { actorId: actor.id, eventType: "invitation.created", resourceType: "invitation", resourceId: id, metadata: { email, roleName: invitedRole } }); return json({ invitation: { id, email, roleName: invitedRole, expiresAt, createdAt: now.toISOString() }, inviteToken: token, warning: "請透過安全管道傳送邀請連結；Token 只會顯示這一次。" }, 201); }
export async function revokeInvitation(request: Request, env: Env, id: string): Promise<Response> { const actor = await owner(request, env); const result = await env.QUERYMIND_APP.prepare("UPDATE invitations SET revoked_at = ? WHERE id = ? AND accepted_at IS NULL AND revoked_at IS NULL").bind(new Date().toISOString(), id).run(); if (!result.meta.changes) throw new HttpError(404, "INVITATION_NOT_FOUND", "Invitation was not found or is already inactive."); await audit(env, { actorId: actor.id, eventType: "invitation.revoked", resourceType: "invitation", resourceId: id }); return json({ ok: true }); }

export async function listApiKeys(request: Request, env: Env, userId: string): Promise<Response> { await owner(request, env); const result = await env.QUERYMIND_APP.prepare("SELECT id, label, key_prefix AS keyPrefix, last_used_at AS lastUsedAt, revoked_at AS revokedAt, created_at AS createdAt FROM api_keys WHERE user_id = ? ORDER BY created_at DESC").bind(userId).all(); return json({ keys: result.results ?? [] }); }
export async function createApiKey(request: Request, env: Env, userId: string): Promise<Response> { const actor = await owner(request, env); const body = objectBody(await readJson(request)); const exists = await env.QUERYMIND_APP.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").bind(userId).first(); if (!exists) throw new HttpError(404, "USER_NOT_FOUND", "Active user was not found."); const rawKey = randomToken("qm_"); const now = new Date().toISOString(); const id = crypto.randomUUID(); const label = requiredText(body.label, "label", 80); const prefix = rawKey.slice(0, 12); await env.QUERYMIND_APP.prepare("INSERT INTO api_keys (id, user_id, label, key_prefix, key_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(id, userId, label, prefix, await hashOpaqueSecret(rawKey, env), now).run(); await audit(env, { actorId: actor.id, eventType: "api_key.created", resourceType: "api_key", resourceId: id, metadata: { userId, prefix } }); return json({ key: { id, label, keyPrefix: prefix, createdAt: now }, apiKey: rawKey, warning: "API Key 只會顯示這一次。" }, 201); }
export async function revokeApiKey(request: Request, env: Env, id: string): Promise<Response> { const actor = await owner(request, env); const result = await env.QUERYMIND_APP.prepare("UPDATE api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL").bind(new Date().toISOString(), id).run(); if (!result.meta.changes) throw new HttpError(404, "API_KEY_NOT_FOUND", "API key was not found or is already revoked."); await audit(env, { actorId: actor.id, eventType: "api_key.revoked", resourceType: "api_key", resourceId: id }); return json({ ok: true }); }

export async function adminOverview(request: Request, env: Env): Promise<Response> { await owner(request, env); const since = new Date(Date.now() - 7 * 86_400_000).toISOString(); const [users, active, calls, auditRows] = await Promise.all([env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM users WHERE is_active = 1").first<{ total: number }>(), env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM users WHERE last_seen_at >= ? AND is_active = 1").bind(since).first<{ total: number }>(), env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM ai_usage_events WHERE created_at >= ?").bind(since).first<{ total: number }>(), env.QUERYMIND_APP.prepare("SELECT a.event_type, a.created_at, u.email FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 12").all()]); return json({ summary: { activeUsers: users?.total ?? 0, weeklyActiveUsers: active?.total ?? 0, aiRequestsLast7Days: calls?.total ?? 0 }, recent: auditRows.results ?? [] }); }
export async function auditLog(request: Request, env: Env): Promise<Response> { await owner(request, env); const url = new URL(request.url); const limit = page(url.searchParams.get("limit"), 50, 200); const result = await env.QUERYMIND_APP.prepare("SELECT a.id, a.event_type AS eventType, a.resource_type AS resourceType, a.resource_id AS resourceId, a.metadata_json AS metadata, a.created_at AS createdAt, u.email AS actorEmail FROM audit_events a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT ?").bind(limit).all(); return json({ events: result.results ?? [] }); }
export async function connectionInfo(request: Request, env: Env): Promise<Response> { const user = await requireUser(request, env); requireBrowserSession(user); requireCapability(user, "refresh_schema"); const tables = await env.QUERYMIND_APP.prepare("SELECT table_count, refreshed_at FROM schema_catalog_state WHERE id = 1").first<{ table_count: number; refreshed_at: string | null }>(); return json({ source: { name: "QueryMind D1", type: "Cloudflare D1", mode: "read-only", tableCount: tables?.table_count ?? 0, schemaRefreshedAt: tables?.refreshed_at ?? null, message: "此部署只連接單一受控 D1；不支援外部連線、寫入或 ETL。" } }); }
export async function systemInfo(request: Request, env: Env): Promise<Response> { await owner(request, env); const [users, sessions, schema] = await Promise.all([env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM users").first<{ total: number }>(), env.QUERYMIND_APP.prepare("SELECT COUNT(*) AS total FROM chat_sessions").first<{ total: number }>(), env.QUERYMIND_APP.prepare("SELECT table_count, refreshed_at FROM schema_catalog_state WHERE id = 1").first<{ table_count: number; refreshed_at: string | null }>()]); return json({ environment: env.ENVIRONMENT, database: { app: "Cloudflare D1", data: "Cloudflare D1 (read-only)", schemaTables: schema?.table_count ?? 0, schemaRefreshedAt: schema?.refreshed_at ?? null }, counts: { users: users?.total ?? 0, sessions: sessions?.total ?? 0 }, aiGatewayConfigured: gatewayConfigured(env), limitations: ["商業資料強制唯讀", "無 ETL 與外部資料庫連線", "D1 為免費方案相容的簡化架構"] }); }
