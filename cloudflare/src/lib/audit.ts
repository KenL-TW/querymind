export async function audit(
  env: Env,
  input: { actorId?: string | null; eventType: string; resourceType?: string; resourceId?: string; metadata?: Record<string, unknown> },
): Promise<void> {
  await env.QUERYMIND_APP.prepare(
    "INSERT INTO audit_events (id, actor_id, event_type, resource_type, resource_id, metadata_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).bind(crypto.randomUUID(), input.actorId ?? null, input.eventType, input.resourceType ?? null, input.resourceId ?? null, JSON.stringify(input.metadata ?? {}), new Date().toISOString()).run();
}
