import { resolveAiProvider } from "../lib/ai-config";
import { requireBrowserSession, requireUser } from "../lib/auth";
import { HttpError, json } from "../lib/http";
import { completeWithAiProvider } from "../lib/ai-provider";

const SMOKE_PROMPT = "Return exactly: READY";
const PROVIDER_ERROR_CODES = new Set([
  "AI_PROVIDER_RATE_LIMIT",
  "AI_PROVIDER_QUOTA",
  "AI_PROVIDER_AUTH",
  "AI_PROVIDER_TIMEOUT",
  "AI_PROVIDER_BAD_REQUEST",
  "AI_PROVIDER_UPSTREAM",
  "AI_PROVIDER_INVALID_RESPONSE",
  "AI_PROVIDER_CONFIG",
]);

export function createAiProviderSmokeHandler(authenticate: typeof requireUser = requireUser) {
  return async (request: Request, env: Env): Promise<Response> => {
    if (env.ENVIRONMENT !== "staging") return json({ error: "API_NOT_IMPLEMENTED", message: "This endpoint is not available." }, 404);

    const user = await authenticate(request, env);
    requireBrowserSession(user);
    if (user.principalType !== "session") throw new HttpError(403, "BROWSER_SESSION_REQUIRED", "This diagnostic requires an authenticated browser session.");
    if (user.roleName !== "owner") throw new HttpError(403, "RBAC_FORBIDDEN", "This diagnostic is restricted to the Staging Owner.");
    if (env.AI_MOCK_MODE !== "false") {
      throw new HttpError(503, "AI_PROVIDER_CONFIG", "The Staging AI provider is not enabled for live diagnostics.");
    }

    const selection = resolveAiProvider(env);
    const startedAt = Date.now();

    try {
      const completion = await completeWithAiProvider(env, {
        model: selection.model,
        messages: [{ role: "user", content: SMOKE_PROMPT }],
        temperature: 0,
        maxOutputTokens: 800,
        signal: request.signal,
      });
      const latencyMs = completion.trace.latencyMs;
      const readyMatched = completion.content === "READY";
      const passed = readyMatched && completion.finishReason === "stop" && completion.toolCalls.length === 0;
      const result = {
        status: passed ? "PASS" : "FAIL",
        provider: completion.trace.providerId,
        model: completion.trace.model,
        readyMatched,
        finishReason: completion.finishReason ?? null,
        contentLength: completion.content?.length ?? 0,
        referenceId: completion.trace.referenceId,
        latencyMs,
        ...(completion.trace.tokenUsage ? { tokenUsage: completion.trace.tokenUsage } : {}),
        ...(!passed ? { error: "AI_PROVIDER_INVALID_RESPONSE" } : {}),
      };
      return json(result, passed ? 200 : 502);
    } catch (error) {
      if (!(error instanceof HttpError) || !PROVIDER_ERROR_CODES.has(error.code)) throw error;
      return json({
        status: "FAIL",
        provider: selection.providerId,
        model: selection.model,
        error: error.code,
        httpStatus: error.status,
        ...(error.referenceId ? { referenceId: error.referenceId } : {}),
        latencyMs: Math.max(0, Date.now() - startedAt),
      }, error.status);
    }
  };
}

export const aiProviderSmoke = createAiProviderSmokeHandler();
