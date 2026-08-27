import {
  BUSINESS_FILTER_OPERATORS,
  DIMENSION_OPERATIONS,
  METRIC_UNITS,
  RELATIONSHIP_CARDINALITIES,
  SEMANTIC_ASSET_TYPES,
  TIME_UNITS,
  type BusinessFilter,
  type DimensionContract,
  type GrainRef,
  type MetricContract,
  type MetricExpression,
  type NormalizedSemanticSource,
  type RelationshipContract,
  type SemanticAssetType,
  type SemanticContract,
  type SemanticDependency,
  type SemanticValidationResult,
  type SourceRef,
  type TermContract,
} from "./semantic-types";

export const SEMANTIC_LIMITS = {
  payloadBytes: 32_000,
  canonicalName: 120,
  displayName: 160,
  definition: 2_000,
  domain: 80,
  dataType: 80,
  currency: 12,
  aliasCount: 20,
  aliasLength: 120,
  localeLength: 16,
  astDepth: 12,
  astNodes: 64,
  literalString: 240,
  filterCount: 20,
  filterInValues: 50,
  sourceCount: 32,
  semanticDependencyCount: 16,
  relationshipJoinKeys: 8,
  grainKeyColumns: 8,
} as const;

const IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]*$/u;
const CANONICAL_NAME = /^[a-z][a-z0-9_]*$/u;
const OPAQUE_ID = /^[A-Za-z0-9_-]{1,128}$/u;

export class SemanticValidationError extends Error {
  readonly code = "SEMANTIC_VALIDATION_FAILED";
  readonly field: string;

  constructor(field: string, message: string) {
    super(`Semantic validation failed for ${field}: ${message}`);
    this.name = "SemanticValidationError";
    this.field = field;
  }
}

type JsonObject = Record<string, unknown>;

function object(value: unknown, path: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new SemanticValidationError(path, "must be an object");
  return value as JsonObject;
}

function keys(value: JsonObject, allowed: readonly string[], path: string): void {
  const allowedSet = new Set(allowed);
  for (const key of Object.keys(value)) if (!allowedSet.has(key)) throw new SemanticValidationError(`${path}.${key}`, "field is not supported");
}

function required(value: JsonObject, key: string, path: string): unknown {
  if (!(key in value)) throw new SemanticValidationError(`${path}.${key}`, "is required");
  return value[key];
}

function stringValue(value: unknown, path: string, maximum: number, nonEmpty = true): string {
  if (typeof value !== "string" || value.length > maximum || (nonEmpty && !value.trim())) throw new SemanticValidationError(path, `must be a ${nonEmpty ? "non-empty " : ""}string up to ${maximum} characters`);
  return value.trim();
}

function canonicalName(value: unknown, path: string): string {
  const text = stringValue(value, path, SEMANTIC_LIMITS.canonicalName);
  if (!CANONICAL_NAME.test(text)) throw new SemanticValidationError(path, "must use lower snake_case canonical naming");
  return text;
}

function identifier(value: unknown, path: string): string {
  const text = stringValue(value, path, 128);
  if (!IDENTIFIER.test(text)) throw new SemanticValidationError(path, "must be a safe identifier");
  return text.toLowerCase();
}

function opaqueId(value: unknown, path: string): string {
  const text = stringValue(value, path, 128);
  if (!OPAQUE_ID.test(text)) throw new SemanticValidationError(path, "must be a bounded opaque identifier");
  return text;
}

function enumValue<T extends string>(value: unknown, allowed: readonly T[], path: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) throw new SemanticValidationError(path, "contains an unsupported value");
  return value as T;
}

function optionalString(value: JsonObject, key: string, path: string, maximum: number): string | undefined {
  if (!(key in value) || value[key] === undefined) return undefined;
  return stringValue(value[key], `${path}.${key}`, maximum, false);
}

function scalar(value: unknown, path: string): string | number | boolean | null {
  if (value === null || typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new SemanticValidationError(path, "number must be finite");
    return value;
  }
  if (typeof value === "string") return stringValue(value, path, SEMANTIC_LIMITS.literalString, false);
  throw new SemanticValidationError(path, "must be a bounded scalar");
}

function sourceRef(value: unknown, path: string): SourceRef {
  const input = object(value, path);
  keys(input, ["table", "column"], path);
  return { table: identifier(required(input, "table", path), `${path}.table`), column: identifier(required(input, "column", path), `${path}.column`) };
}

function dependencies(value: unknown, path: string): SemanticDependency[] {
  if (!Array.isArray(value) || value.length > SEMANTIC_LIMITS.semanticDependencyCount) throw new SemanticValidationError(path, `must contain at most ${SEMANTIC_LIMITS.semanticDependencyCount} dependencies`);
  return value.map((item, index) => {
    const input = object(item, `${path}[${index}]`);
    keys(input, ["referencedAssetId", "referencedRevisionId"], `${path}[${index}]`);
    return {
      referencedAssetId: opaqueId(required(input, "referencedAssetId", `${path}[${index}]`), `${path}[${index}].referencedAssetId`),
      referencedRevisionId: opaqueId(required(input, "referencedRevisionId", `${path}[${index}]`), `${path}[${index}].referencedRevisionId`),
    };
  });
}

function grain(value: unknown, path: string): GrainRef {
  const input = object(value, path);
  const kind = enumValue(required(input, "kind", path), ["ENTITY", "TIME"] as const, `${path}.kind`);
  const key = canonicalName(required(input, "key", path), `${path}.key`);
  if (kind === "ENTITY") {
    keys(input, ["kind", "key", "source"], path);
    const source = object(required(input, "source", path), `${path}.source`);
    keys(source, ["table", "keyColumns"], `${path}.source`);
    const columns = required(source, "keyColumns", `${path}.source`);
    if (!Array.isArray(columns) || columns.length === 0 || columns.length > SEMANTIC_LIMITS.grainKeyColumns) throw new SemanticValidationError(`${path}.source.keyColumns`, `must contain 1-${SEMANTIC_LIMITS.grainKeyColumns} columns`);
    return { kind, key, source: { table: identifier(required(source, "table", `${path}.source`), `${path}.source.table`), keyColumns: columns.map((column, index) => identifier(column, `${path}.source.keyColumns[${index}]`)) } };
  }
  keys(input, ["kind", "key", "source", "timeUnit"], path);
  return { kind, key, source: sourceRef(required(input, "source", path), `${path}.source`), timeUnit: enumValue(required(input, "timeUnit", path), TIME_UNITS, `${path}.timeUnit`) };
}

function businessFilters(value: unknown, path: string): BusinessFilter[] {
  if (!Array.isArray(value) || value.length > SEMANTIC_LIMITS.filterCount) throw new SemanticValidationError(path, `must contain at most ${SEMANTIC_LIMITS.filterCount} filters`);
  return value.map((item, index) => {
    const itemPath = `${path}[${index}]`;
    const input = object(item, itemPath);
    keys(input, ["field", "operator", "value"], itemPath);
    const operator = enumValue(required(input, "operator", itemPath), BUSINESS_FILTER_OPERATORS, `${itemPath}.operator`);
    const hasValue = "value" in input;
    if ((operator === "IS_NULL" || operator === "IS_NOT_NULL") === hasValue) throw new SemanticValidationError(itemPath, "null checks cannot carry a value and other operators require one");
    let filter: BusinessFilter = { field: sourceRef(required(input, "field", itemPath), `${itemPath}.field`), operator };
    if (hasValue) {
      if (operator === "IN" || operator === "NOT_IN") {
        if (!Array.isArray(input.value) || input.value.length === 0 || input.value.length > SEMANTIC_LIMITS.filterInValues) throw new SemanticValidationError(`${itemPath}.value`, `must contain 1-${SEMANTIC_LIMITS.filterInValues} values`);
        filter = { ...filter, value: input.value.map((entry, valueIndex) => scalar(entry, `${itemPath}.value[${valueIndex}]`)) };
      } else filter = { ...filter, value: scalar(input.value, `${itemPath}.value`) };
    }
    return filter;
  });
}

interface ExpressionStats { depth: number; nodes: number; }

function expression(value: unknown, path: string, depth = 1, stats: ExpressionStats = { depth: 0, nodes: 0 }): MetricExpression {
  if (depth > SEMANTIC_LIMITS.astDepth) throw new SemanticValidationError(path, `AST depth exceeds ${SEMANTIC_LIMITS.astDepth}`);
  stats.nodes += 1;
  stats.depth = Math.max(stats.depth, depth);
  if (stats.nodes > SEMANTIC_LIMITS.astNodes) throw new SemanticValidationError(path, `AST node count exceeds ${SEMANTIC_LIMITS.astNodes}`);
  const input = object(value, path);
  const kind = stringValue(required(input, "kind", path), `${path}.kind`, 32);
  if (kind === "COLUMN") {
    keys(input, ["kind", "source"], path);
    return { kind, source: sourceRef(required(input, "source", path), `${path}.source`) };
  }
  if (kind === "LITERAL") {
    keys(input, ["kind", "value"], path);
    return { kind, value: scalar(required(input, "value", path), `${path}.value`) };
  }
  if (["ADD", "SUBTRACT", "MULTIPLY", "DIVIDE"].includes(kind)) {
    keys(input, ["kind", "left", "right", "divisionByZero"], path);
    if (kind === "DIVIDE") {
      if (input.divisionByZero !== "NULL") throw new SemanticValidationError(`${path}.divisionByZero`, "must explicitly be NULL");
      return { kind, left: expression(required(input, "left", path), `${path}.left`, depth + 1, stats), right: expression(required(input, "right", path), `${path}.right`, depth + 1, stats), divisionByZero: "NULL" };
    }
    if ("divisionByZero" in input) throw new SemanticValidationError(`${path}.divisionByZero`, "is only valid for DIVIDE");
    return { kind: kind as "ADD" | "SUBTRACT" | "MULTIPLY", left: expression(required(input, "left", path), `${path}.left`, depth + 1, stats), right: expression(required(input, "right", path), `${path}.right`, depth + 1, stats) };
  }
  if (["SUM", "AVG", "MIN", "MAX"].includes(kind)) {
    keys(input, ["kind", "argument"], path);
    return { kind: kind as "SUM" | "AVG" | "MIN" | "MAX", argument: expression(required(input, "argument", path), `${path}.argument`, depth + 1, stats) };
  }
  if (kind === "COUNT") {
    const mode = enumValue(required(input, "mode", path), ["ROWS", "COLUMN"] as const, `${path}.mode`);
    if (mode === "ROWS") {
      keys(input, ["kind", "mode"], path);
      return { kind, mode };
    }
    keys(input, ["kind", "mode", "source"], path);
    return { kind, mode, source: sourceRef(required(input, "source", path), `${path}.source`) };
  }
  if (kind === "COUNT_DISTINCT") {
    keys(input, ["kind", "source"], path);
    return { kind, source: sourceRef(required(input, "source", path), `${path}.source`) };
  }
  throw new SemanticValidationError(`${path}.kind`, "unsupported metric expression operator");
}

function commonContract(input: JsonObject, path: string): { canonicalName: string; displayName: string; definition: string; domain: string; semanticDependencies: SemanticDependency[] } {
  const canonical = canonicalName(required(input, "canonicalName", path), `${path}.canonicalName`);
  const display = stringValue(required(input, "displayName", path), `${path}.displayName`, SEMANTIC_LIMITS.displayName);
  const definition = stringValue(required(input, "definition", path), `${path}.definition`, SEMANTIC_LIMITS.definition);
  const domain = stringValue(required(input, "domain", path), `${path}.domain`, SEMANTIC_LIMITS.domain, false);
  const semanticDependencies = dependencies(required(input, "semanticDependencies", path), `${path}.semanticDependencies`);
  return { canonicalName: canonical, displayName: display, definition, domain, semanticDependencies };
}

function termContract(value: unknown): TermContract {
  const input = object(value, "contract");
  keys(input, ["canonicalName", "displayName", "definition", "domain", "source", "semanticDependencies"], "contract");
  const common = commonContract(input, "contract");
  const source = "source" in input && input.source !== undefined ? sourceRef(input.source, "contract.source") : undefined;
  return { ...common, ...(source ? { source } : {}) };
}

function dimensionContract(value: unknown): DimensionContract {
  const input = object(value, "contract");
  keys(input, ["canonicalName", "displayName", "definition", "domain", "source", "dataType", "allowedOperations", "nativeGrain", "semanticDependencies"], "contract");
  const common = commonContract(input, "contract");
  const operationsValue = required(input, "allowedOperations", "contract");
  if (!Array.isArray(operationsValue) || operationsValue.length === 0 || operationsValue.length > DIMENSION_OPERATIONS.length) throw new SemanticValidationError("contract.allowedOperations", "must contain supported operations");
  const allowedOperations = [...new Set(operationsValue.map((item, index) => enumValue(item, DIMENSION_OPERATIONS, `contract.allowedOperations[${index}]`)))];
  const nativeGrain = "nativeGrain" in input && input.nativeGrain !== undefined ? grain(input.nativeGrain, "contract.nativeGrain") : undefined;
  return { ...common, source: sourceRef(required(input, "source", "contract"), "contract.source"), dataType: stringValue(required(input, "dataType", "contract"), "contract.dataType", SEMANTIC_LIMITS.dataType), allowedOperations, ...(nativeGrain ? { nativeGrain } : {}) };
}

function metricContract(value: unknown): MetricContract {
  const input = object(value, "contract");
  keys(input, ["canonicalName", "displayName", "definition", "domain", "sources", "expression", "defaultFilters", "nativeGrain", "timeDimension", "unit", "currency", "semanticDependencies"], "contract");
  const common = commonContract(input, "contract");
  const sourceValues = required(input, "sources", "contract");
  if (!Array.isArray(sourceValues) || sourceValues.length === 0 || sourceValues.length > SEMANTIC_LIMITS.sourceCount) throw new SemanticValidationError("contract.sources", `must contain 1-${SEMANTIC_LIMITS.sourceCount} sources`);
  const sources = sourceValues.map((item, index) => {
    const path = `contract.sources[${index}]`;
    const source = object(item, path);
    keys(source, ["ref", "role"], path);
    return { ref: sourceRef(required(source, "ref", path), `${path}.ref`), role: enumValue(required(source, "role", path), ["value", "join", "filter", "time"] as const, `${path}.role`) };
  });
  const sourceKeys = new Set(sources.map((item) => `${item.role}:${item.ref.table}.${item.ref.column}`));
  if (sourceKeys.size !== sources.length) throw new SemanticValidationError("contract.sources", "cannot contain duplicate source roles");
  const timeDimension = "timeDimension" in input && input.timeDimension !== undefined ? sourceRef(input.timeDimension, "contract.timeDimension") : undefined;
  const unit = enumValue(required(input, "unit", "contract"), METRIC_UNITS, "contract.unit");
  const currency = optionalString(input, "currency", "contract", SEMANTIC_LIMITS.currency);
  if (unit === "CURRENCY" && !currency) throw new SemanticValidationError("contract.currency", "is required for CURRENCY metrics");
  if (unit !== "CURRENCY" && currency) throw new SemanticValidationError("contract.currency", "is only valid for CURRENCY metrics");
  return { ...common, sources, expression: expression(required(input, "expression", "contract"), "contract.expression"), defaultFilters: businessFilters(required(input, "defaultFilters", "contract"), "contract.defaultFilters"), nativeGrain: grain(required(input, "nativeGrain", "contract"), "contract.nativeGrain"), ...(timeDimension ? { timeDimension } : {}), unit, ...(currency ? { currency } : {}) };
}

function relationshipContract(value: unknown): RelationshipContract {
  const input = object(value, "contract");
  keys(input, ["canonicalName", "displayName", "definition", "domain", "leftTable", "rightTable", "cardinality", "joinKeys", "semanticDependencies"], "contract");
  const common = commonContract(input, "contract");
  const joinValues = required(input, "joinKeys", "contract");
  if (!Array.isArray(joinValues) || joinValues.length === 0 || joinValues.length > SEMANTIC_LIMITS.relationshipJoinKeys) throw new SemanticValidationError("contract.joinKeys", `must contain 1-${SEMANTIC_LIMITS.relationshipJoinKeys} keys`);
  const joinKeys = joinValues.map((item, index) => {
    const path = `contract.joinKeys[${index}]`;
    const key = object(item, path);
    keys(key, ["leftTable", "leftColumn", "rightTable", "rightColumn"], path);
    return { leftTable: identifier(required(key, "leftTable", path), `${path}.leftTable`), leftColumn: identifier(required(key, "leftColumn", path), `${path}.leftColumn`), rightTable: identifier(required(key, "rightTable", path), `${path}.rightTable`), rightColumn: identifier(required(key, "rightColumn", path), `${path}.rightColumn`) };
  });
  const tupleSet = new Set(joinKeys.map((key) => `${key.leftTable}.${key.leftColumn}->${key.rightTable}.${key.rightColumn}`));
  if (tupleSet.size !== joinKeys.length) throw new SemanticValidationError("contract.joinKeys", "cannot contain duplicate keys");
  const leftTable = identifier(required(input, "leftTable", "contract"), "contract.leftTable");
  const rightTable = identifier(required(input, "rightTable", "contract"), "contract.rightTable");
  if (!joinKeys.every((key) => key.leftTable === leftTable && key.rightTable === rightTable)) throw new SemanticValidationError("contract.joinKeys", "all keys must use the declared relationship endpoints");
  return { ...common, leftTable, rightTable, cardinality: enumValue(required(input, "cardinality", "contract"), RELATIONSHIP_CARDINALITIES, "contract.cardinality"), joinKeys };
}

export function validateContract(assetType: SemanticAssetType, value: unknown): SemanticValidationResult {
  if (!SEMANTIC_ASSET_TYPES.includes(assetType)) throw new SemanticValidationError("assetType", "unsupported asset type");
  const contract = assetType === "TERM" ? termContract(value)
    : assetType === "DIMENSION" ? dimensionContract(value)
      : assetType === "METRIC" ? metricContract(value)
        : relationshipContract(value);
  const payloadJson = JSON.stringify(contract);
  if (new TextEncoder().encode(payloadJson).byteLength > SEMANTIC_LIMITS.payloadBytes) throw new SemanticValidationError("payload", `must be at most ${SEMANTIC_LIMITS.payloadBytes} bytes`);
  return { contract, payloadJson, normalizedSources: extractNormalizedSources(assetType, contract) };
}

function addColumn(rows: Omit<NormalizedSemanticSource, "sourceId" | "revisionId">[], seen: Set<string>, tableName: string, columnName: string, role: string): void {
  const table = tableName.toLowerCase();
  const column = columnName.toLowerCase();
  const key = `COLUMN|${table}|${column}|${role}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ sourceKind: "COLUMN", tableName: table, columnName: column, referencedAssetId: null, referencedRevisionId: null, role, ordinalPosition: rows.length });
}

function addTable(rows: Omit<NormalizedSemanticSource, "sourceId" | "revisionId">[], seen: Set<string>, tableName: string, role: string): void {
  const table = tableName.toLowerCase();
  const key = `TABLE|${table}|${role}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ sourceKind: "TABLE", tableName: table, columnName: null, referencedAssetId: null, referencedRevisionId: null, role, ordinalPosition: rows.length });
}

function addSemanticDependency(rows: Omit<NormalizedSemanticSource, "sourceId" | "revisionId">[], seen: Set<string>, dependency: SemanticDependency): void {
  const key = `SEMANTIC_DEPENDENCY|${dependency.referencedAssetId}|${dependency.referencedRevisionId}`;
  if (seen.has(key)) return;
  seen.add(key);
  rows.push({ sourceKind: "SEMANTIC_DEPENDENCY", tableName: null, columnName: null, referencedAssetId: dependency.referencedAssetId, referencedRevisionId: dependency.referencedRevisionId, role: "semantic_dependency", ordinalPosition: rows.length });
}

function expressionSources(value: MetricExpression, rows: Omit<NormalizedSemanticSource, "sourceId" | "revisionId">[], seen: Set<string>): void {
  switch (value.kind) {
    case "COLUMN": addColumn(rows, seen, value.source.table, value.source.column, "expression"); return;
    case "LITERAL": return;
    case "COUNT": if (value.mode === "COLUMN") addColumn(rows, seen, value.source.table, value.source.column, "expression"); return;
    case "COUNT_DISTINCT": addColumn(rows, seen, value.source.table, value.source.column, "expression"); return;
    case "SUM":
    case "AVG":
    case "MIN":
    case "MAX": expressionSources(value.argument, rows, seen); return;
    case "ADD":
    case "SUBTRACT":
    case "MULTIPLY":
    case "DIVIDE": expressionSources(value.left, rows, seen); expressionSources(value.right, rows, seen); return;
  }
}

export function extractNormalizedSources(assetType: SemanticAssetType, contract: SemanticContract): Omit<NormalizedSemanticSource, "sourceId" | "revisionId">[] {
  const rows: Omit<NormalizedSemanticSource, "sourceId" | "revisionId">[] = [];
  const seen = new Set<string>();
  if (assetType === "TERM") {
    const term = contract as TermContract;
    if (term.source) addColumn(rows, seen, term.source.table, term.source.column, "term");
    for (const dependency of term.semanticDependencies) addSemanticDependency(rows, seen, dependency);
    return rows;
  }
  if (assetType === "DIMENSION") {
    const dimension = contract as DimensionContract;
    addColumn(rows, seen, dimension.source.table, dimension.source.column, "dimension");
    if (dimension.nativeGrain) {
      if (dimension.nativeGrain.kind === "ENTITY") for (const column of dimension.nativeGrain.source.keyColumns) addColumn(rows, seen, dimension.nativeGrain.source.table, column, "grain");
      else addColumn(rows, seen, dimension.nativeGrain.source.table, dimension.nativeGrain.source.column, "grain");
    }
    for (const dependency of dimension.semanticDependencies) addSemanticDependency(rows, seen, dependency);
    return rows;
  }
  if (assetType === "METRIC") {
    const metric = contract as MetricContract;
    for (const source of metric.sources) addColumn(rows, seen, source.ref.table, source.ref.column, `source:${source.role}`);
    expressionSources(metric.expression, rows, seen);
    for (const filter of metric.defaultFilters) addColumn(rows, seen, filter.field.table, filter.field.column, "default_filter");
    if (metric.timeDimension) addColumn(rows, seen, metric.timeDimension.table, metric.timeDimension.column, "time_dimension");
    if (metric.nativeGrain.kind === "ENTITY") for (const column of metric.nativeGrain.source.keyColumns) addColumn(rows, seen, metric.nativeGrain.source.table, column, "grain");
    else addColumn(rows, seen, metric.nativeGrain.source.table, metric.nativeGrain.source.column, "grain");
    for (const dependency of metric.semanticDependencies) addSemanticDependency(rows, seen, dependency);
    return rows;
  }
  const relationship = contract as RelationshipContract;
  addTable(rows, seen, relationship.leftTable, "relationship_left");
  addTable(rows, seen, relationship.rightTable, "relationship_right");
  for (const key of relationship.joinKeys) {
    addColumn(rows, seen, key.leftTable, key.leftColumn, "relationship_join_left");
    addColumn(rows, seen, key.rightTable, key.rightColumn, "relationship_join_right");
  }
  for (const dependency of relationship.semanticDependencies) addSemanticDependency(rows, seen, dependency);
  return rows;
}

export interface NormalizedAlias {
  alias: string;
  normalizedAlias: string;
  locale: string;
}

export function validateAliases(value: unknown): NormalizedAlias[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > SEMANTIC_LIMITS.aliasCount) throw new SemanticValidationError("aliases", `must contain at most ${SEMANTIC_LIMITS.aliasCount} aliases`);
  const seen = new Set<string>();
  return value.map((item, index) => {
    const path = `aliases[${index}]`;
    const input = object(item, path);
    keys(input, ["alias", "locale"], path);
    const alias = stringValue(required(input, "alias", path), `${path}.alias`, SEMANTIC_LIMITS.aliasLength);
    const locale = optionalString(input, "locale", path, SEMANTIC_LIMITS.localeLength) ?? "";
    const normalizedAlias = alias.toLocaleLowerCase("und");
    const key = `${normalizedAlias}|${locale}`;
    if (seen.has(key)) throw new SemanticValidationError(path, "contains a duplicate alias");
    seen.add(key);
    return { alias, normalizedAlias, locale };
  });
}

export function validateAssetName(value: unknown, field: string): string {
  return canonicalName(value, field);
}

export function validateBoundedText(value: unknown, field: string, maximum: number, nonEmpty = false): string {
  return stringValue(value, field, maximum, nonEmpty);
}

/** Review text is untrusted governance input and must remain inert text. */
export function validateReviewComment(value: unknown, field = "comment"): string {
  const comment = stringValue(value ?? "", field, 2_000, false);
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(comment)) {
    throw new SemanticValidationError(field, "contains unsupported control characters");
  }
  return comment;
}

export function validateOpaqueId(value: unknown, field: string): string {
  return opaqueId(value, field);
}
