export async function audit(
  env: Env,
  input: { actorId?: string | null; eventType: string; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await env.QUERYMIND_APP.prepare(
    "INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), input.actorId ?? null, input.eventType, input.resourceType ?? null, input.resourceId ?? null, JSON.stringify(input.metadata ?? {}), new Date().toISOString()).run();
}

const SEMANTIC_AUDIT_FIELDS = new Set([
  "assetId", "revisionId", "assetType", "revisionNumber", "action", "schemaSnapshotId",
  "runId", "suggestionId", "suggestionType", "promptFingerprint", "modelConfigFingerprint",
  "policyId", "authorityId", "scopeKind", "domain", "riskClass", "requiredApprovals",
  "publicationId", "publicationMode", "registryVersionBefore", "registryVersionAfter", "resultCode",
]);
const SEMANTIC_AUDIT_EVENTS = new Set([
  "semantic.asset.created",
  "semantic.revision.created",
  "semantic.revision.updated",
  "semantic.review.submitted",
  "semantic.review.request_changes",
  "semantic.review.rejected",
  "semantic.suggestion.generated",
  "semantic.suggestion.accepted_as_draft",
  "semantic.suggestion.dismissed",
  "semantic.suggestion.generation_failed",
  "semantic.governance.policy.created",
  "semantic.governance.authority.created",
  "semantic.governance.authority.deactivated",
]);

/**
 * Semantic governance audit is intentionally narrower than the product-wide
 * audit helper. Review bodies, payload JSON, prompts, row filters and secrets
 * never enter generic metadata through this boundary.
 */
export function semanticAuditStatement(
  database: D1Database,
  input: { actorId: string; eventType: string; resourceType: string; resourceId: string; metadata: Record<string, unknown> },
  guard?: { existsSql: string; values: unknown[] },
): D1PreparedStatement {
  if (!SEMANTIC_AUDIT_EVENTS.has(input.eventType)) throw new Error("Unsupported semantic audit event.");
  const metadata: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input.metadata)) if (SEMANTIC_AUDIT_FIELDS.has(key)) metadata[key] = value;
  const values = [crypto.randomUUID(), input.actorId, input.eventType, input.resourceType, input.resourceId, JSON.stringify(metadata), new Date().toISOString()];
  if (guard) {
    return database.prepare(
      `INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at) SELECT ?, ?, ?, ?, ?, ?, ? WHERE EXISTS (${guard.existsSql})`,
    ).bind(...values, ...guard.values);
  }
  return database.prepare(
    "INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(...values);
}

export async function auditSemantic(
  env: Env,
  input: { actorId: string; eventType: string; resourceType: string; resourceId: string; metadata: Record<string, unknown> },
): Promise<void> {
  await semanticAuditStatement(env.QUERYMIND_APP, input).run();
}
