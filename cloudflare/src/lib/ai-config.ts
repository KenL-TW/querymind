export type AiAvailability = "mock" | "ready" | "pending";

const GATEWAY_PATH = /^\/v1\/[^/]+\/[^/]+\/openai\/chat\/completions$/u;

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

export function aiAvailability(env: Env): AiAvailability {
  if (env.ENVIRONMENT !== "production" && env.AI_MOCK_MODE === "true") return "mock";
  return gatewayConfigured(env) ? "ready" : "pending";
}

export function gatewayHeaders(env: Env, userId: string, sessionId: string): Headers {
  const headers = new Headers({
    "content-type": "application/json",
    "cf-aig-authorization": `Bearer ${env.AI_GATEWAY_TOKEN}`,
    "cf-aig-metadata": JSON.stringify({ user_id: userId, session_id: sessionId, product: "querymind" }),
  });
  if (env.AI_GATEWAY_BYOK_ALIAS.trim()) headers.set("cf-aig-byok-alias", env.AI_GATEWAY_BYOK_ALIAS.trim());
  return headers;
}
