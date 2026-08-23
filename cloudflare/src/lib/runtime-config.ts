import { gatewayConfigured } from "./ai-config";
import { HttpError } from "./http";

/** Static production invariants. This intentionally runs before any local auth fallback. */
export function assertStaticRuntimeConfiguration(env: Env): void {
  const production = env.ENVIRONMENT === "production";
  if (!env.QUERYMIND_APP || !env.QUERYMIND_DATA) throw new HttpError(503, "D1_NOT_CONFIGURED", "Required D1 bindings are not configured.");
  if (!production) return;
  if (env.AUTH_REQUIRED !== "true") throw new HttpError(503, "AUTH_REQUIRED_CONFIG", "Production authentication must be enabled.");
  if (!env.AUTH_JWT_SECRET || !env.AUTH_PASSWORD_PEPPER || !env.AUTH_BOOTSTRAP_TOKEN) throw new HttpError(503, "AUTH_NOT_CONFIGURED", "Production authentication secrets are incomplete.");
  if (env.AI_MOCK_MODE === "true") throw new HttpError(503, "AI_MOCK_MODE_FORBIDDEN", "AI mock mode must be disabled in production.");
  if (env.AI_MOCK_MODE !== "false") throw new HttpError(503, "AI_MOCK_MODE_CONFIG", "AI_MOCK_MODE must be explicitly false in production.");
  if (!gatewayConfigured(env)) throw new HttpError(503, "AI_GATEWAY_NOT_CONFIGURED", "AI Gateway configuration is incomplete.");
}
