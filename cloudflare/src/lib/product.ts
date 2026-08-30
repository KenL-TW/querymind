import { HttpError } from "./http";

export const ROLE_NAMES = ["viewer", "analyst", "editor", "dba", "owner"] as const;
export type RoleName = (typeof ROLE_NAMES)[number];

// Product capabilities are deliberately finite.  Role definitions remain
// configurable, but an accidental typo must not silently create a permission
// that neither the UI nor the Worker will ever enforce.
export const PRODUCT_CAPABILITIES = [
  "chat",
  "view_schema",
  "view_dictionary",
  "view_templates",
  "manage_own_sessions",
  "manage_own_insights",
  "view_own_usage",
  "export",
  "manage_templates",
  "manage_dictionary",
  "refresh_schema",
  "manage_users",
  "view_semantics",
  "manage_semantic_drafts",
  "review_semantics",
  "approve_semantics",
  "emergency_publish_semantics",
  "suspend_semantics_runtime",
  "resume_semantics_runtime",
  "manage_semantic_governance",
] as const;
export const MAX_SAFE_RESULT_ROWS = 10_000;

export function isProductCapability(value: unknown): value is (typeof PRODUCT_CAPABILITIES)[number] {
  return typeof value === "string" && PRODUCT_CAPABILITIES.includes(value as (typeof PRODUCT_CAPABILITIES)[number]);
}

export function objectBody(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new HttpError(400, "INVALID_REQUEST", "Request body must be a JSON object.");
  return value as Record<string, unknown>;
}

export function requiredText(value: unknown, field: string, maximum: number): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > maximum) throw new HttpError(400, "INVALID_REQUEST", `${field} must be a non-empty string up to ${maximum} characters.`);
  return value.trim();
}

export function optionalText(value: unknown, field: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length > maximum) throw new HttpError(400, "INVALID_REQUEST", `${field} must be a string up to ${maximum} characters.`);
  return value.trim();
}

export function roleName(value: unknown): RoleName {
  if (typeof value !== "string" || !ROLE_NAMES.includes(value as RoleName)) throw new HttpError(400, "INVALID_ROLE", "roleName must be a supported role.");
  return value as RoleName;
}

export function booleanValue(value: unknown, field: string): boolean | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") throw new HttpError(400, "INVALID_REQUEST", `${field} must be a boolean.`);
  return value;
}

export function page(value: string | null, fallback = 1, maximum = 100): number {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), maximum) : fallback;
}
