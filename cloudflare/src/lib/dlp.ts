import { HttpError } from "./http";

export interface ColumnPolicy {
  table_name: string;
  column_name: string;
  mask_mode: "none" | "partial" | "full";
}

type MaskMode = ColumnPolicy["mask_mode"];

interface ProjectionClause {
  depth: number;
  start: number;
  projection: string;
}

interface ProjectionOutput {
  name: string;
  reliable: boolean;
  expression: string;
}

export interface SensitiveProjectionAnalysis {
  aliases: Map<string, MaskMode>;
  conservativeMaskAll: boolean;
  sensitiveNonProjectionReference: boolean;
  sensitiveStructuralInference: boolean;
}

const DEFAULT_SENSITIVE_NAMES = ["email", "phone", "address", "birth_date", "salary"] as const;

function maskValue(value: unknown, mode: MaskMode): unknown {
  if (value === null || mode === "none") return value;
  if (mode === "full") return "[REDACTED]";
  const text = String(value);
  return text.length <= 2 ? "**" : `${text.slice(0, 2)}***`;
}

function escaped(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }

function stronger(left: MaskMode | undefined, right: MaskMode): MaskMode {
  if (left === "full" || right === "full") return "full";
  if (left === "partial" || right === "partial") return "partial";
  return "none";
}

function withoutStringLiterals(sql: string): string {
  let output = "";
  let singleQuoted = false;
  for (let index = 0; index < sql.length; index += 1) {
    const character = sql[index];
    if (singleQuoted) {
      output += " ";
      if (character === "'" && sql[index + 1] === "'") {
        output += " ";
        index += 1;
      } else if (character === "'") singleQuoted = false;
    } else if (character === "'") {
      singleQuoted = true;
      output += " ";
    } else output += character;
  }
  return output;
}

function projectionClauses(sql: string): ProjectionClause[] {
  const clauses: ProjectionClause[] = [];
  const pending: Array<{ depth: number; start: number }> = [];
  let depth = 0;
  let quote: "'" | '"' | "`" | "]" | null = null;

  for (let index = 0; index < sql.length;) {
    const character = sql[index];
    if (quote) {
      const closes = (quote === "]" && character === "]") || (quote !== "]" && character === quote);
      if (closes && quote !== "]" && sql[index + 1] === quote) {
        index += 2;
        continue;
      }
      if (closes) quote = null;
      index += 1;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") {
      quote = character;
      index += 1;
      continue;
    }
    if (character === "[") {
      quote = "]";
      index += 1;
      continue;
    }
    if (character === "(") {
      depth += 1;
      index += 1;
      continue;
    }
    if (character === ")") {
      depth = Math.max(0, depth - 1);
      index += 1;
      continue;
    }
    if (/[A-Za-z_]/u.test(character)) {
      let end = index + 1;
      while (end < sql.length && /[A-Za-z0-9_]/u.test(sql[end])) end += 1;
      const word = sql.slice(index, end).toLowerCase();
      if (word === "select") pending.push({ depth, start: end });
      if (word === "from") {
        let pendingIndex = pending.length - 1;
        while (pendingIndex >= 0 && pending[pendingIndex].depth !== depth) pendingIndex -= 1;
        if (pendingIndex >= 0) {
          const selected = pending[pendingIndex];
          pending.splice(pendingIndex, 1);
          clauses.push({ depth, start: selected.start, projection: sql.slice(selected.start, index) });
        }
      }
      index = end;
      continue;
    }
    index += 1;
  }
  return clauses;
}

function splitProjection(projection: string): string[] {
  const expressions: string[] = [];
  let start = 0;
  let depth = 0;
  let quote: "'" | '"' | "`" | "]" | null = null;
  for (let index = 0; index < projection.length; index += 1) {
    const character = projection[index];
    if (quote) {
      const closes = (quote === "]" && character === "]") || (quote !== "]" && character === quote);
      if (closes && quote !== "]" && projection[index + 1] === quote) index += 1;
      else if (closes) quote = null;
      continue;
    }
    if (character === "'" || character === '"' || character === "`") quote = character;
    else if (character === "[") quote = "]";
    else if (character === "(") depth += 1;
    else if (character === ")") depth = Math.max(0, depth - 1);
    else if (character === "," && depth === 0) {
      expressions.push(projection.slice(start, index).trim());
      start = index + 1;
    }
  }
  expressions.push(projection.slice(start).trim());
  return expressions.filter(Boolean);
}

function isWildcardProjection(expression: string): boolean {
  return /^(?:(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\.\s*)?\*$/u.test(expression.trim());
}

const IDENTIFIER = '(?:"([^"]+)"|`([^`]+)`|\\[([^\\]]+)\\]|([A-Za-z_][A-Za-z0-9_]*))';

function identifierValue(match: RegExpMatchArray, offset: number): string {
  return (match[offset] ?? match[offset + 1] ?? match[offset + 2] ?? match[offset + 3] ?? "").toLowerCase();
}

function projectionOutput(expression: string): ProjectionOutput {
  const trimmed = expression.trim();
  const explicit = trimmed.match(new RegExp(`^(.*\\S)\\s+as\\s+${IDENTIFIER}\\s*$`, "iu"));
  if (explicit) return { name: identifierValue(explicit, 2), reliable: true, expression: explicit[1].trim() };

  const implicit = trimmed.match(new RegExp(`^(.*\\S)\\s+${IDENTIFIER}\\s*$`, "u"));
  if (implicit && !/(?:[+\-*/%<>=,]|\\b(?:as|collate|else|filter|then|when|where))\\s*$/iu.test(implicit[1])) {
    return { name: identifierValue(implicit, 2), reliable: true, expression: implicit[1].trim() };
  }

  const direct = trimmed.match(new RegExp(`^(?:${IDENTIFIER}\\s*\\.\\s*)?${IDENTIFIER}$`, "u"));
  if (direct) return { name: identifierValue(direct, 5), reliable: true, expression: trimmed };
  return { name: trimmed.toLowerCase(), reliable: false, expression: trimmed };
}

function modeForExpression(expression: string, sources: Map<string, MaskMode>): MaskMode | undefined {
  const output = projectionOutput(expression);
  if (/^count\s*\(\s*\*\s*\)$/iu.test(withoutStringLiterals(output.expression).trim())) return undefined;
  const searchable = withoutStringLiterals(output.expression);
  let mode: MaskMode | undefined;
  for (const [name, sourceMode] of sources) {
    const pattern = new RegExp(`(?<![A-Za-z0-9_])${escaped(name)}(?![A-Za-z0-9_])`, "iu");
    if (pattern.test(searchable)) mode = stronger(mode, sourceMode);
  }
  return mode;
}

function effectivePolicies(rows: ColumnPolicy[]): ColumnPolicy[] {
  const policies = [...rows];
  const configuredColumns = new Set(rows.map((policy) => policy.column_name.toLowerCase()));
  for (const columnName of DEFAULT_SENSITIVE_NAMES) {
    if (!configuredColumns.has(columnName)) policies.push({ table_name: "*", column_name: columnName, mask_mode: "full" });
  }
  return policies;
}

function containsSensitiveReference(fragment: string, sources: Map<string, MaskMode>): boolean {
  const searchable = withoutStringLiterals(fragment);
  for (const name of sources.keys()) {
    if (new RegExp(`(?<![A-Za-z0-9_])${escaped(name)}(?![A-Za-z0-9_])`, "iu").test(searchable)) return true;
  }
  return false;
}

function sqlOutsideProjections(sql: string, clauses: ProjectionClause[]): string {
  if (!clauses.length) return sql;
  const characters = sql.split("");
  for (const clause of clauses) {
    const end = clause.start + clause.projection.length;
    for (let index = clause.start; index < end; index += 1) characters[index] = " ";
  }
  return characters.join("");
}

/**
 * Trace sensitive projection aliases through nested SELECTs and CTEs. A
 * sensitive expression without a reliable result alias cannot be safely
 * matched to a D1 result key, so callers must conservatively mask every output
 * column instead of risking a transformed-value leak (for example lower(email)).
 */
export function analyzeSensitiveProjection(sql: string | undefined, policies: ColumnPolicy[]): SensitiveProjectionAnalysis {
  const sources = new Map<string, MaskMode>();
  for (const policy of policies) {
    const key = policy.column_name.toLowerCase();
    sources.set(key, stronger(sources.get(key), policy.mask_mode));
  }
  if (!sql) return { aliases: sources, conservativeMaskAll: false, sensitiveNonProjectionReference: false, sensitiveStructuralInference: false };

  const clauses = projectionClauses(sql);
  const ordered = clauses.slice().sort((left, right) => right.depth - left.depth || left.start - right.start);
  // Two bounded passes cover chained CTE aliases at the same nesting depth.
  for (let pass = 0; pass < 2; pass += 1) {
    for (const clause of ordered) {
      for (const expression of splitProjection(clause.projection)) {
        const mode = modeForExpression(expression, sources);
        if (!mode) continue;
        const output = projectionOutput(expression);
        if (output.name) sources.set(output.name, stronger(sources.get(output.name), mode));
      }
    }
  }

  let conservativeMaskAll = false;
  let nestedSensitiveProjection = false;
  for (const clause of clauses) {
    for (const expression of splitProjection(clause.projection)) {
      const mode = modeForExpression(expression, sources);
      if (!mode) {
        if (clause.depth > 0 && isWildcardProjection(expression)) nestedSensitiveProjection = true;
        continue;
      }
      const output = projectionOutput(expression);
      if (!output.reliable) conservativeMaskAll = true;
      else if (output.name) sources.set(output.name, stronger(sources.get(output.name), mode));
      // A sensitive SELECT nested inside parentheses may influence an outer
      // predicate or ordering even when the outer SELECT has no FROM clause.
      // Conservatively reject all such nested projection shapes pre-execution.
      if (clause.depth > 0) nestedSensitiveProjection = true;
    }
  }
  // `WITH cte(explicit_name) AS (SELECT sensitive_column ...)` renames by
  // position rather than with a projection alias. Without a full SQL AST the
  // final output lineage is ambiguous, so protect the complete result.
  const explicitCteColumns = /\b(?:with(?:\s+recursive)?|,)\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][A-Za-z0-9_]*)\s*\([^)]*\)\s+as\s*\(\s*select\b/iu.test(withoutStringLiterals(sql));
  if (nestedSensitiveProjection && explicitCteColumns) conservativeMaskAll = true;
  // Even when a sensitive value is absent from the SELECT list, predicates,
  // grouping and ordering can reveal it through row counts/order/differences.
  // Without an AST-backed non-interference proof, mask the complete result.
  const sensitiveNonProjectionReference = containsSensitiveReference(sqlOutsideProjections(sql, clauses), sources);
  if (sensitiveNonProjectionReference) conservativeMaskAll = true;
  const hasSensitiveProjection = clauses.some((clause) => splitProjection(clause.projection).some((expression) => Boolean(modeForExpression(expression, sources))));
  const hasWildcardProjection = clauses.some((clause) => splitProjection(clause.projection).some(isWildcardProjection));
  const mayProjectSensitive = hasSensitiveProjection || hasWildcardProjection;
  const structuralSql = withoutStringLiterals(sql);
  const hasNaturalJoin = /\bnatural\s+(?:left\s+|right\s+|full\s+|inner\s+|cross\s+)?join\b/iu.test(structuralSql);
  const sensitiveStructuralInference = hasNaturalJoin || nestedSensitiveProjection || (mayProjectSensitive && (
    /\b(?:distinct|union|intersect|except)\b/iu.test(structuralSql)
    || /\b(?:order|group)\s+by\s+\d+\b/iu.test(structuralSql)
  ));
  if (sensitiveStructuralInference) conservativeMaskAll = true;
  return { aliases: sources, conservativeMaskAll, sensitiveNonProjectionReference, sensitiveStructuralInference };
}

async function configuredPolicies(env: Env): Promise<ColumnPolicy[]> {
  const result = await env.QUERYMIND_APP.prepare(
    "SELECT table_name, column_name, mask_mode FROM column_policies WHERE mask_mode <> 'none' LIMIT 500",
  ).all<ColumnPolicy>();
  return effectivePolicies(result.results ?? []);
}

/**
 * Reject inference-bearing SQL before it reaches the business D1. Masking the
 * projected values is not enough when WHERE/HAVING/GROUP/ORDER can disclose a
 * sensitive membership bit through zero/one rows, cardinality, or ordering.
 */
export async function assertNoSensitiveInference(env: Env, sql: string): Promise<void> {
  const analysis = analyzeSensitiveProjection(sql, await configuredPolicies(env));
  if (analysis.sensitiveNonProjectionReference || analysis.sensitiveStructuralInference) {
    throw new HttpError(
      400,
      "SENSITIVE_INFERENCE_BLOCKED",
      "Sensitive columns may be selected for masking, but cannot be used in filters, grouping, ordering, joins, or aggregate predicates.",
    );
  }
}

export async function maskedQueryRows(env: Env, rows: Record<string, unknown>[], sql?: string): Promise<{ rows: Record<string, unknown>[]; maskedColumns: string[] }> {
  const policies = await configuredPolicies(env);
  const analysis = analyzeSensitiveProjection(sql, policies);
  const directPolicies = new Map<string, MaskMode>();
  for (const policy of policies) {
    const key = policy.column_name.toLowerCase();
    directPolicies.set(key, stronger(directPolicies.get(key), policy.mask_mode));
  }

  const resultColumns = new Set(rows.flatMap((row) => Object.keys(row).map((column) => column.toLowerCase())));
  const maskModeFor = (column: string): MaskMode => analysis.conservativeMaskAll
    ? "full"
    : directPolicies.get(column) ?? analysis.aliases.get(column) ?? "none";
  return {
    maskedColumns: [...resultColumns].filter((column) => maskModeFor(column) !== "none").sort(),
    rows: rows.map((row) => Object.fromEntries(Object.entries(row).map(([column, value]) => [
      column,
      maskValue(value, maskModeFor(column.toLowerCase())),
    ]))),
  };
}
