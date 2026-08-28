import { HttpError } from "./http";
import type { QueryExplainability } from "./explainability";

export const FEEDBACK_VERSION = "p1.2" as const;
export const FEEDBACK_TARGET_TYPES = [
  "WHOLE_ANSWER", "INTENT", "METRIC", "DIMENSION", "FILTER", "SOURCE", "CALCULATION", "PRESENTATION",
] as const;
export type FeedbackTargetType = (typeof FEEDBACK_TARGET_TYPES)[number];

export const FEEDBACK_CATEGORIES = [
  "interpretation", "metric", "dimension", "filter", "source", "calculation", "incomplete", "scope", "presentation", "other",
] as const;
export type FeedbackCategory = (typeof FEEDBACK_CATEGORIES)[number];

export interface FeedbackTarget {
  type: FeedbackTargetType;
  ref: string | null;
}

export interface FeedbackInput {
  version: typeof FEEDBACK_VERSION;
  rating: "POSITIVE" | "NEEDS_ADJUSTMENT";
  target: FeedbackTarget;
  category: FeedbackCategory | null;
  comment: string;
  correction: string;
  legacy: boolean;
}

const LEGACY_CATEGORIES = new Set(["interpretation", "source", "calculation", "incomplete", "scope", "other"]);
const TARGET_SET = new Set<string>(FEEDBACK_TARGET_TYPES);
const CATEGORY_SET = new Set<string>(FEEDBACK_CATEGORIES);
const MAX_TARGET_REF = 160;
const MAX_COMMENT = 800;
const MAX_CORRECTION = 1000;

function invalid(message: string): never {
  throw new HttpError(400, "INVALID_FEEDBACK", message);
}

function text(value: unknown, field: string, max: number, optional = true): string {
  if (value === undefined || value === null) return optional ? "" : invalid(`${field} is required.`);
  if (typeof value !== "string") invalid(`${field} must be a string.`);
  const normalized = value.trim();
  if (normalized.length > max) invalid(`${field} must be at most ${max} characters.`);
  return normalized;
}

function targetFromBody(value: unknown, rating: FeedbackInput["rating"]): FeedbackTarget {
  if (value === undefined || value === null) {
    if (rating === "POSITIVE") return { type: "WHOLE_ANSWER", ref: null };
    invalid("target is required for adjustment feedback.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("target must be an object.");
  const record = value as Record<string, unknown>;
  const rawType = typeof record.type === "string" ? record.type.trim().toUpperCase() : "";
  if (!TARGET_SET.has(rawType)) invalid("target.type is not supported.");
  const type = rawType as FeedbackTargetType;
  const ref = text(record.ref, "target.ref", MAX_TARGET_REF);
  if (type === "WHOLE_ANSWER" && ref) invalid("WHOLE_ANSWER must not include a target reference.");
  if (type !== "WHOLE_ANSWER" && !ref) invalid("target.ref is required for evidence feedback.");
  return { type, ref: ref || null };
}

/**
 * Parse both the released P1 body and the P1.2 body. P1 callers continue to
 * store their original lowercase rating/category contract; P1.2 receives a
 * stable uppercase rating and a query-run evidence target.
 */
export function parseFeedbackInput(body: Record<string, unknown>): FeedbackInput {
  const explicitVersion = body.version;
  const legacy = explicitVersion === undefined || explicitVersion === null || explicitVersion === "p1";
  if (!legacy && explicitVersion !== FEEDBACK_VERSION) invalid("version is not supported.");

  const rawRating = body.rating;
  let rating: FeedbackInput["rating"];
  if (legacy) {
    if (rawRating !== "positive" && rawRating !== "negative") invalid("rating must be positive or negative.");
    rating = rawRating === "positive" ? "POSITIVE" : "NEEDS_ADJUSTMENT";
  } else {
    if (rawRating !== "POSITIVE" && rawRating !== "NEEDS_ADJUSTMENT") invalid("rating must be POSITIVE or NEEDS_ADJUSTMENT.");
    rating = rawRating;
  }

  const target = legacy && body.target === undefined
    ? { type: "WHOLE_ANSWER" as const, ref: null }
    : targetFromBody(body.target, rating);
  const rawCategory = body.category === undefined || body.category === null || body.category === "" ? null : body.category;
  if (rawCategory !== null && typeof rawCategory !== "string") invalid("category is not supported.");
  const categoryValue = rawCategory === null ? null : rawCategory.trim().toLowerCase();
  if (categoryValue !== null && !(legacy ? LEGACY_CATEGORIES.has(categoryValue) : CATEGORY_SET.has(categoryValue))) invalid("category is not supported.");
  const category = categoryValue as FeedbackCategory | null;
  const comment = text(body.comment, "comment", MAX_COMMENT);
  const correction = text(body.correction, "correction", MAX_CORRECTION);
  if (legacy && body.correction !== undefined) invalid("correction is only supported by the p1.2 feedback contract.");
  if (rating === "NEEDS_ADJUSTMENT" && category === null && (legacy || (target.type === "WHOLE_ANSWER" && !comment && !correction))) invalid("Choose a target, issue category, or adjustment note for feedback.");
  if (rating === "POSITIVE" && (category || correction) && !legacy) {
    // Positive feedback remains one-click by design; optional explanatory text
    // is accepted only when a caller explicitly supplies it for compatibility.
  }
  return { version: legacy ? "p1.2" : FEEDBACK_VERSION, rating, target, category, comment, correction, legacy };
}

function arrayHas(values: unknown, value: string): boolean {
  return Array.isArray(values) && values.some((entry) => typeof entry === "string" && entry === value);
}

/**
 * Validate a target against the deterministic evidence persisted on the
 * governed query run. The helper never evaluates SQL/JSON paths and never
 * uses client supplied data to make an authorization decision.
 */
export function targetExistsInExplainability(target: FeedbackTarget, explainability: QueryExplainability | null): boolean {
  if (!explainability) return target.type === "WHOLE_ANSWER";
  if (target.type === "WHOLE_ANSWER") return target.ref === null;
  const ref = target.ref;
  if (!ref) return false;
  if (target.type === "INTENT") return explainability.understanding?.intent === ref;
  if (target.type === "METRIC") return arrayHas(explainability.understanding?.metrics, ref);
  if (target.type === "DIMENSION") return arrayHas(explainability.understanding?.dimensions, ref);
  if (target.type === "FILTER") return arrayHas(explainability.understanding?.filters, ref);
  if (target.type === "SOURCE") return Boolean(explainability.sources?.tables?.some((source) => source.name === ref));
  if (target.type === "CALCULATION") return ref === "calculation" && Boolean(explainability.explanation?.business);
  if (target.type === "PRESENTATION") return ref === "result" && Boolean(explainability.summary?.headline);
  return false;
}

export function legacyCategory(category: FeedbackCategory | null): string | null {
  if (!category) return null;
  if (LEGACY_CATEGORIES.has(category)) return category;
  if (category === "metric" || category === "dimension" || category === "filter") return "interpretation";
  if (category === "presentation") return "other";
  return "other";
}

export function feedbackRatingForStorage(rating: FeedbackInput["rating"]): "positive" | "negative" {
  return rating === "POSITIVE" ? "positive" : "negative";
}

export function feedbackRatingForResponse(rating: "positive" | "negative", version: string): "positive" | "negative" | "POSITIVE" | "NEEDS_ADJUSTMENT" {
  return version === FEEDBACK_VERSION ? (rating === "positive" ? "POSITIVE" : "NEEDS_ADJUSTMENT") : rating;
}

export function parseStoredExplainability(value: unknown): QueryExplainability | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value) as QueryExplainability;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

export const FEEDBACK_LIMITS = { maxTargetRef: MAX_TARGET_REF, maxComment: MAX_COMMENT, maxCorrection: MAX_CORRECTION } as const;
