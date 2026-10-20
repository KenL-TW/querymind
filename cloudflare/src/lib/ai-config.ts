import { HttpError } from "./http";

export type AiAvailability = "mock" | "ready" | "pending";
export type AiProviderId = "openai_gateway" | "workers_ai";

export interface AiProviderSelection {
  providerId: AiProviderId;
  model: string;
}

const GATEWAY_PATH = /^\/v1\/[^/]+\/[^/]+\/openai\/chat\/completions$/u;
const PRODUCTION_WORKERS_AI_MODEL = "@cf/zai-org/glm-4.7-flash";
const STAGING_WORKERS_AI_MODELS = new Set([
  PRODUCTION_WORKERS_AI_MODEL,
  "@cf/qwen/qwen3.8-27b",
  "@cf/meta/llama-4-scout-17b-16e-instruct",
  "@cf/deepseek-ai/deepseek-v4-flash-0731",
  "@cf/zai-org/glm-5.3-flash",
]);

export function validGatewayUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:"
      && url.hostname === "gateway.ai.cloudflare.com"
      && url.username === ""
      && url.password === ""
      && url.search === ""
      && url.hash === ""
      && GATEWAY_PATH.test(url.pathname);
  } catch {
    return false;
  }
}

export function gatewayConfigured(env: Env): boolean {
  const token = env.AI_GATEWAY_TOKEN ?? "";
  return validGatewayUrl(env.AI_GATEWAY_URL)
    && token.length > 20
    && !token.startsWith("not-configured");
}

/**
 * Provider selection is server-only. Missing AI_PROVIDER intentionally keeps
 * the pre-PX-AI-01 OpenAI Gateway behavior; it never acts as a failure fallback.
 */
export function resolveAiProvider(env: Env): AiProviderSelection {
  const providerId = (env.AI_PROVIDER ?? "openai_gateway").trim();
  if (providerId === "openai_gateway") {
    const allowed = (env.ALLOWED_OPENAI_MODELS ?? "").split(",").map((model) => model.trim()).filter(Boolean);
    const model = (env.OPENAI_MODEL ?? "").trim();
    if (!model || !allowed.includes(model)) {
      throw new HttpError(503, "AI_PROVIDER_CONFIG", "OpenAI provider model configuration is invalid.");
    }
    return { providerId, model };
  }
  if (providerId === "workers_ai") {
    const model = (env.WORKERS_AI_MODEL ?? "").trim();
    const allowed = env.ENVIRONMENT === "staging"
      ? STAGING_WORKERS_AI_MODELS.has(model)
      : model === PRODUCTION_WORKERS_AI_MODEL;
    if (!allowed) {
      throw new HttpError(503, "AI_PROVIDER_CONFIG", "Workers AI model configuration is invalid.");
    }
    return { providerId, model };
  }
  throw new HttpError(503, "AI_PROVIDER_CONFIG", "AI provider selection is invalid.");
}

export function aiProviderConfigured(env: Env): boolean {
  try {
    const selection = resolveAiProvider(env);
    if (selection.providerId === "openai_gateway") return gatewayConfigured(env);
    return Boolean(env.AI && typeof env.AI.run === "function");
  } catch {
    return false;
  }
}

export function aiAvailability(env: Env): AiAvailability {
  if (env.ENVIRONMENT !== "production" && env.AI_MOCK_MODE === "true") return "mock";
  return aiProviderConfigured(env) ? "ready" : "pending";
}

export function gatewayHeaders(env: Env, referenceId: string): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
    "cf-aig-metadata": JSON.stringify({ product: "querymind" }),
    "cf-aig-event-id": referenceId,
    "cf-aig-collect-log-payload": "false",
  });
  if (env.AI_GATEWAY_BYOK_ALIAS.trim()) headers.set("cf-aig-byok-alias", env.AI_GATEWAY_BYOK_ALIAS.trim());
  return headers;
}
