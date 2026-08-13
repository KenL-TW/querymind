import { requireBrowserSession, requireCapability, requireUser } from "../lib/auth";
import { json } from "../lib/http";
import { refreshSchemaCatalog, schemaContext } from "../lib/schema-catalog";

export async function refreshSchema(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireBrowserSession(user);
  requireCapability(user, "refresh_schema");
  return json(await refreshSchemaCatalog(env));
}

export async function getSchema(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "view_schema");
  return json({ context: await schemaContext(env) });
}
