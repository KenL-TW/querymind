import { requireBrowserSession, requireCapability, requireUser } from "../lib/auth";
import { HttpError, json, readJson } from "../lib/http";
import { objectBody, page } from "../lib/product";
import { consumeRateLimit, hashSubject } from "../lib/rate-limit";
import { authorizedSchemaCatalog } from "../lib/schema-catalog";
import { acceptSemanticSuggestionAsDraft, assertSemanticCatalogReferences, SemanticRepositoryError } from "../lib/semantic-repository";
import { extractSemanticCandidates, selectedCatalog, SEMANTIC_INTELLIGENCE_LIMITS } from "../lib/semantic-intelligence-candidates";
import { generateSuggestionOutput, prepareSuggestionGeneration, SEMANTIC_SUGGESTION_PROMPT_VERSION } from "../lib/semantic-intelligence";
import { createSuggestionRun, dismissStoredSuggestion, failSuggestionRun, getStoredSuggestion, listStoredSuggestions, persistSuggestionRunSuccess, suggestionIsAuthorized, suggestionStatus, suggestionType } from "../lib/semantic-suggestion-repository";
import { resolveEffectiveScope } from "../lib/scope";
import { SEMANTIC_ASSET_TYPES, type SemanticAssetType, type SemanticContract } from "../lib/semantic-types";
import { SemanticValidationError, validateAliases, validateAssetName, validateBoundedText, validateContract, validateOpaqueId } from "../lib/semantic-validation";

const REQUEST_BYTES = 64_000;

function suggestionError(error: unknown): never {
  if (error instanceof HttpError) throw error;
  if (error instanceof SemanticValidationError) {
    throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "Semantic draft input is invalid.");
  }
  if (error instanceof Error) {
    if (error.message === "INVALID_TABLE_SELECTION") {
      throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "Select between 1 and 8 authorized tables.");
    }
    if (error.message === "UNAUTHORIZED_TABLE_SELECTION") {
      throw new HttpError(403, "SUGGESTION_TABLE_FORBIDDEN", "One or more selected tables are not authorized.");
    }
    if (error.message === "SUGGESTION_CATALOG_TOO_LARGE") {
      throw new HttpError(413, "SUGGESTION_CATALOG_TOO_LARGE", "Selected schema metadata exceeds the column limit.");
    }
  }
  if (error instanceof SemanticRepositoryError) {
    const status = error.code.includes("NOT_FOUND") ? 404
      : error.code === "SEMANTIC_SCHEMA_STALE" ? 409
        : error.code.endsWith("CONFLICT") ? 409
          : 400;
    const code = error.code === "SEMANTIC_SCHEMA_STALE" ? "SUGGESTION_STALE"
      : error.code.includes("NOT_FOUND") ? "SUGGESTION_NOT_FOUND"
        : error.code.endsWith("CONFLICT") ? "SUGGESTION_STATE_CONFLICT" : error.code;
    throw new HttpError(status, code, error.message);
  }
  const message = error instanceof Error ? error.message : "";
  if (/UNIQUE constraint failed:\s*semantic_assets/iu.test(message)) {
    throw new HttpError(409, "SUGGESTION_DUPLICATE", "A semantic asset with this type, canonical name, and domain already exists.");
  }
  throw error;
}

async function governed<T>(operation: () => Promise<T>): Promise<T> {
  try { return await operation(); } catch (error) { return suggestionError(error); }
}

async function body(request: Request, allowed: readonly string[]): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) throw new HttpError(415, "SEMANTIC_CONTENT_TYPE_REQUIRED", "Semantic suggestion mutations require application/json.");
  const result = objectBody(await readJson(request, REQUEST_BYTES));
  const allowedFields = new Set(allowed);
  for (const key of Object.keys(result)) if (!allowedFields.has(key)) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", `Unsupported suggestion field: ${key}.`);
  return result;
}

function tableNames(value: unknown): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > SEMANTIC_INTELLIGENCE_LIMITS.selectedTables || !value.every((name) => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name))) {
    throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "tableNames must contain 1 to 8 table identifiers.");
  }
  const names = [...new Set(value.map((name) => name.toLowerCase()))];
  if (names.length !== value.length) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "tableNames must not contain duplicates.");
  return names;
}

function types(value: unknown): SemanticAssetType[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > SEMANTIC_ASSET_TYPES.length || !value.every((type) => typeof type === "string" && SEMANTIC_ASSET_TYPES.includes(type as SemanticAssetType))) {
    throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "suggestionTypes must contain supported semantic types.");
  }
  const items = [...new Set(value as SemanticAssetType[])];
  if (items.length !== value.length) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "suggestionTypes must not contain duplicates.");
  return items;
}

function maximum(value: unknown): number {
  if (!Number.isInteger(value) || (value as number) < 1 || (value as number) > SEMANTIC_INTELLIGENCE_LIMITS.requestedSuggestions) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "maxSuggestions must be between 1 and 12.");
  return value as number;
}

async function rateLimitSuggestions(env: Env, userId: string): Promise<void> {
  const requestLimit = Math.min(Math.max(Number(env.AI_USER_REQUESTS_PER_HOUR) || 20, 1), 200);
  const globalLimit = Math.min(Math.max(Number(env.AI_GLOBAL_REQUESTS_PER_DAY) || 200, 1), 10_000);
  await consumeRateLimit(env.QUERYMIND_APP, await hashSubject(`ai:${userId}`), 3_600, requestLimit);
  await consumeRateLimit(env.QUERYMIND_APP, await hashSubject("ai:global"), 86_400, globalLimit);
}

function publicSuggestion(value: Awaited<ReturnType<typeof getStoredSuggestion>>["suggestion"]) {
  return value;
}

async function ownedSuggestion(env: Env, userId: string, suggestionId: string) {
  const currentSnapshot = (await env.QUERYMIND_APP.prepare("SELECT schema_snapshot_id FROM schema_catalog_state WHERE id = 1").first<{ schema_snapshot_id: string | null }>())?.schema_snapshot_id;
  if (!currentSnapshot || currentSnapshot === "uninitialized") throw new HttpError(409, "SEMANTIC_SCHEMA_UNAVAILABLE", "Schema catalog snapshot identity is unavailable.");
  const stored = await getStoredSuggestion(env.QUERYMIND_APP, suggestionId, currentSnapshot);
  if (stored.requestedBy !== userId) throw new HttpError(404, "SUGGESTION_NOT_FOUND", "Semantic suggestion was not found.");
  return stored;
}

export async function generateSemanticSuggestions(request: Request, env: Env): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const payload = await body(request, ["tableNames", "suggestionTypes", "maxSuggestions"]);
    const selectedNames = tableNames(payload.tableNames);
    const requestedTypes = types(payload.suggestionTypes);
    const maxSuggestions = maximum(payload.maxSuggestions);
    await rateLimitSuggestions(env, user.id);
    const scope = await resolveEffectiveScope(env, user);
    const catalog = selectedCatalog(await authorizedSchemaCatalog(env, scope), selectedNames);
    // Fail invalid/empty candidate sets before a paid model request.
    if (extractSemanticCandidates(catalog, requestedTypes).length === 0) throw new HttpError(400, "SUGGESTION_CANDIDATES_EMPTY", "No safe semantic candidates were found for the selected metadata.");
    const plan = await prepareSuggestionGeneration(env, catalog, requestedTypes, maxSuggestions);
    const runId = crypto.randomUUID();
    await createSuggestionRun(env.QUERYMIND_APP, {
      runId,
      requestedBy: user.id,
      schemaSnapshotId: catalog.schemaSnapshotId,
      requestScope: { tableNames: catalog.selectedTableNames, suggestionTypes: requestedTypes, maxSuggestions },
      catalogFingerprint: plan.catalogFingerprint,
      promptVersion: SEMANTIC_SUGGESTION_PROMPT_VERSION,
      promptFingerprint: plan.promptFingerprint,
      provider: "cloudflare-ai-gateway-openai-byok",
      model: plan.model,
      modelConfigFingerprint: plan.modelConfigFingerprint,
    });
    try {
      const generated = await generateSuggestionOutput(env, { userId: user.id, runId, catalog, maximum: maxSuggestions, signal: request.signal, plan });
      const suggestions = await persistSuggestionRunSuccess(env.QUERYMIND_APP, { runId, actorId: user.id, attempts: generated.attempts, suggestions: generated.suggestions, schemaSnapshotId: catalog.schemaSnapshotId, promptFingerprint: generated.promptFingerprint, modelConfigFingerprint: generated.modelConfigFingerprint });
      return json({ runId, status: "SUCCEEDED", suggestionCount: suggestions.length, items: suggestions });
    } catch (error) {
      const attempts = typeof error === "object" && error && "suggestionAttempts" in error && typeof (error as { suggestionAttempts?: unknown }).suggestionAttempts === "number" ? (error as { suggestionAttempts: number }).suggestionAttempts : 0;
      const code = error instanceof HttpError ? error.code : "SUGGESTION_GENERATION_FAILED";
      try { await failSuggestionRun(env.QUERYMIND_APP, { runId, actorId: user.id, attempts, errorCode: code, schemaSnapshotId: catalog.schemaSnapshotId, promptFingerprint: plan.promptFingerprint, modelConfigFingerprint: plan.modelConfigFingerprint }); } catch { /* preserve the original safe failure */ }
      throw error;
    }
  });
}

/** Authorized table picker for the P2-D workspace; no raw DDL or scope data. */
export async function semanticSuggestionCatalog(request: Request, env: Env): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const catalog = await authorizedSchemaCatalog(env, await resolveEffectiveScope(env, user));
    return json({ schemaSnapshotId: catalog.schemaSnapshotId, tables: catalog.tables.map((table) => ({ table: table.name, columns: table.columns.map((column) => column.name) })) });
  });
}

export async function listSemanticSuggestions(request: Request, env: Env): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const url = new URL(request.url);
    const scope = await resolveEffectiveScope(env, user);
    const catalog = await authorizedSchemaCatalog(env, scope);
    const staleText = url.searchParams.get("stale");
    if (staleText !== null && staleText !== "true" && staleText !== "false") throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "stale must be true or false.");
    const result = await listStoredSuggestions(env.QUERYMIND_APP, { requestedBy: user.id, currentSchemaSnapshotId: catalog.schemaSnapshotId, status: suggestionStatus(url.searchParams.get("status")), type: suggestionType(url.searchParams.get("type")), runId: url.searchParams.get("run") ?? undefined, stale: staleText === null ? undefined : staleText === "true", page: page(url.searchParams.get("page"), 1, 100), limit: page(url.searchParams.get("limit"), 30, 100) });
    // If a later scope change removes a source, do not use historical
    // suggestion text to reveal that now-unauthorized metadata.
    const visible = result.items.filter((item) => suggestionIsAuthorized(item.suggestion, catalog)).map((item) => publicSuggestion(item.suggestion));
    return json({ items: visible, page: { page: page(url.searchParams.get("page"), 1, 100), limit: page(url.searchParams.get("limit"), 30, 100), total: visible.length, hasNext: false } });
  });
}

export async function getSemanticSuggestion(request: Request, env: Env, suggestionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const stored = await ownedSuggestion(env, user.id, suggestionId);
    const catalog = await authorizedSchemaCatalog(env, await resolveEffectiveScope(env, user));
    if (!suggestionIsAuthorized(stored.suggestion, catalog)) throw new HttpError(404, "SUGGESTION_NOT_FOUND", "Semantic suggestion was not found.");
    return json(publicSuggestion(stored.suggestion));
  });
}

export async function dismissSemanticSuggestion(request: Request, env: Env, suggestionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const payload = await body(request, ["dismissalReason"]);
    const stored = await ownedSuggestion(env, user.id, suggestionId);
    const catalog = await authorizedSchemaCatalog(env, await resolveEffectiveScope(env, user));
    if (!suggestionIsAuthorized(stored.suggestion, catalog)) throw new HttpError(404, "SUGGESTION_NOT_FOUND", "Semantic suggestion was not found.");
    await dismissStoredSuggestion(env.QUERYMIND_APP, { suggestionId, actorId: user.id, reason: payload.dismissalReason === undefined ? undefined : validateBoundedText(payload.dismissalReason, "dismissalReason", 1000), schemaSnapshotId: stored.suggestion.schemaSnapshotId, promptFingerprint: stored.promptFingerprint, modelConfigFingerprint: stored.modelConfigFingerprint, suggestionType: stored.suggestion.suggestionType });
    return json({ suggestionId, status: "DISMISSED" });
  });
}

function draftPayload(value: Record<string, unknown>, userId: string, type: SemanticAssetType) {
  const canonicalName = validateAssetName(value.canonicalName, "canonicalName");
  const displayName = validateBoundedText(value.displayName, "displayName", 160, true);
  const ownerUserId = value.ownerUserId === undefined ? userId : validateOpaqueId(value.ownerUserId, "ownerUserId");
  const contract = validateContract(type, value.contract).contract;
  if (contract.canonicalName !== canonicalName || contract.displayName !== displayName) throw new HttpError(400, "SEMANTIC_VALIDATION_ERROR", "Draft identity must match its semantic contract.");
  return { canonicalName, displayName, ownerUserId, contract, aliases: validateAliases(value.aliases).map((alias) => ({ alias: alias.alias, ...(alias.locale ? { locale: alias.locale } : {}) })), domain: value.domain === undefined ? undefined : validateBoundedText(value.domain, "domain", 80), description: value.description === undefined ? undefined : validateBoundedText(value.description, "description", 2000), changeReason: value.changeReason === undefined ? undefined : validateBoundedText(value.changeReason, "changeReason", 1000) };
}

export async function acceptSemanticSuggestionAsDraftApi(request: Request, env: Env, suggestionId: string): Promise<Response> {
  return governed(async () => {
    const user = await requireUser(request, env);
    requireBrowserSession(user);
    requireCapability(user, "manage_semantic_drafts");
    const payload = await body(request, ["canonicalName", "displayName", "domain", "description", "ownerUserId", "contract", "aliases", "changeReason"]);
    const stored = await ownedSuggestion(env, user.id, suggestionId);
    const scope = await resolveEffectiveScope(env, user);
    const catalog = await authorizedSchemaCatalog(env, scope);
    if (stored.suggestion.status !== "OPEN") throw new HttpError(409, "SUGGESTION_STATE_CONFLICT", "Only an OPEN suggestion can be used to create a Draft.");
    if (stored.suggestion.isStale || stored.suggestion.schemaSnapshotId !== catalog.schemaSnapshotId) throw new HttpError(409, "SUGGESTION_STALE", "This suggestion was generated against an older schema snapshot. Regenerate suggestions before creating a Draft.");
    const draft = draftPayload(payload, user.id, stored.suggestion.suggestionType);
    const candidate = { ...stored.suggestion, suggestion: { ...stored.suggestion.suggestion, contract: draft.contract } };
    if (!suggestionIsAuthorized(candidate, catalog)) throw new HttpError(403, "SUGGESTION_SOURCE_FORBIDDEN", "Draft sources are no longer authorized for this user.");
    await assertSemanticCatalogReferences(env.QUERYMIND_APP, validateContract(stored.suggestion.suggestionType, draft.contract));
    const owner = await env.QUERYMIND_APP.prepare("SELECT id FROM users WHERE id = ? AND is_active = 1").bind(draft.ownerUserId).first<{ id: string }>();
    if (!owner) throw new HttpError(400, "SEMANTIC_OWNER_INVALID", "ownerUserId must reference an active user.");
    const duplicate = await env.QUERYMIND_APP.prepare("SELECT asset_id FROM semantic_assets WHERE asset_type = ? AND canonical_name = ? AND domain = ? LIMIT 1").bind(stored.suggestion.suggestionType, draft.canonicalName, draft.domain ?? "").first<{ asset_id: string }>();
    if (duplicate) throw new HttpError(409, "SUGGESTION_DUPLICATE", "A semantic asset with this type, canonical name, and domain already exists.");
    const result = await acceptSemanticSuggestionAsDraft(env.QUERYMIND_APP, { suggestionId, acceptedBy: user.id, expectedSuggestionSnapshotId: stored.suggestion.schemaSnapshotId, promptFingerprint: stored.promptFingerprint, modelConfigFingerprint: stored.modelConfigFingerprint, assetType: stored.suggestion.suggestionType, canonicalName: draft.canonicalName, displayName: draft.displayName, domain: draft.domain, description: draft.description, ownerUserId: draft.ownerUserId, createdBy: user.id, schemaSnapshotId: catalog.schemaSnapshotId, changeReason: draft.changeReason, contract: draft.contract, aliases: draft.aliases });
    return json({ suggestionId, status: "ACCEPTED", assetId: result.assetId, revisionId: result.revisionId, revisionNumber: result.revisionNumber, draftStatus: "DRAFT" }, 201);
  });
}
