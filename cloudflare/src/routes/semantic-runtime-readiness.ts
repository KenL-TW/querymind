import { requireCapability, requireUser } from "../lib/auth";
import { json } from "../lib/http";
import { semanticRuntimeActivationReadiness } from "../lib/semantic-runtime-readiness";

/** Read-only P2-H platform gate; view permission does not grant approval authority. */
export async function semanticRuntimeReadiness(request: Request, env: Env): Promise<Response> {
  const user = await requireUser(request, env);
  requireCapability(user, "view_semantics");
  return json(await semanticRuntimeActivationReadiness(env));
}
